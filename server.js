#!/usr/bin/env node
'use strict';
/**
 * ccwatch - bu makinedeki tum Claude Code (CLI) session'larini canli izler.
 *
 *   node server.js            -> http://localhost:7788 panelini acar
 *   node server.js --once     -> terminale bir kerelik tablo basar
 *   node server.js --json     -> ham JSON basar (script'lemek icin)
 *   node server.js --install  -> macOS'ta acilista otomatik baslat (launchd)
 *   node server.js --uninstall/--status -> servisi kaldir / durumunu goster
 *
 * Bagimlilik yok, sadece Node stdlib.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFileSync, spawn } = require('child_process');

const HOME = os.homedir();
const CLAUDE_DIR = path.join(HOME, '.claude');
const SESSIONS_DIR = path.join(CLAUDE_DIR, 'sessions');
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');

const argv = process.argv.slice(2);
const hasFlag = (f) => argv.includes(f);
const flagValue = (f, d) => {
  const i = argv.indexOf(f);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : d;
};

const PORT = parseInt(flagValue('--port', process.env.CCWATCH_PORT || '7788'), 10);
// Gunlerdir ayakta duran bir launchd sunucusu, repo guncellenince eski kodu servis
// etmeye devam ediyor. Surumu disari veriyoruz ki Electron uygulamasi boyle bir
// sunucuyu benimsemek yerine kendi taze kopyasini kaldirabilsin.
const VERSION = (() => {
  try {
    return require('./package.json').version;
  } catch {
    return '0';
  }
})();

const TAIL_BYTES = 192 * 1024;      // transcript'in son N byte'i okunur
const COLD_MS = 15 * 60 * 1000;     // bu kadar sessiz kalan "idle" session artik sogumus sayilir
const ENDED_WINDOW_MS = 3 * 24 * 3600 * 1000; // kapanmis session'lari kac gun geriye listeleyelim

// ---------------------------------------------------------------- process tablosu

const LSTART_RE = /^(\w{3}\s+\w{3}\s+\d+\s+\d{2}:\d{2}:\d{2}\s+\d{4})$/;

function psSnapshot() {
  const map = new Map();
  let out = '';
  try {
    out = execFileSync('ps', ['-axo', 'pid=,ppid=,tty=,%cpu=,rss=,lstart=,command='], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch {
    return map;
  }
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    // pid ppid tty cpu rss "Wed Aug  5 10:14:51 2026" command...
    const m = line.match(
      /^\s*(\d+)\s+(\d+)\s+(\S+)\s+([\d.]+)\s+(\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.*)$/
    );
    if (!m) continue;
    const started = Date.parse(m[6].replace(/\s+/g, ' '));
    map.set(parseInt(m[1], 10), {
      pid: parseInt(m[1], 10),
      ppid: parseInt(m[2], 10),
      tty: m[3] === '??' ? null : m[3],
      cpu: parseFloat(m[4]),
      rssMb: Math.round(parseInt(m[5], 10) / 1024),
      startedAt: Number.isFinite(started) ? started : null,
      command: m[7],
    });
  }
  return map;
}

function looksLikeClaude(command) {
  if (!command) return false;
  // Claude Desktop / Claude Usage.app gibi GUI uygulamalarini eleyelim
  if (/Claude Usage\.app|\/Claude\.app\//.test(command)) return false;
  const first = command.split(/\s+/)[0];
  if (/(^|\/)claude$/.test(first)) return true;                    // `claude` ya da .../native-binary/claude
  if (/anthropic\.claude-code[^\s]*\/.*\/claude/.test(first)) return true; // VS Code eklentisi
  if (/\/\.claude\/local\/.*claude/.test(first)) return true;      // local kurulum
  if (/node$/.test(first) && /claude.*(cli\.js|\.mjs)/.test(command)) return true;
  return false;
}

// hangi uygulamanin altinda kosuyor (Terminal / VS Code / baska bir claude)
function hostOf(proc, procs) {
  const parent = proc && procs.get(proc.ppid);
  const pcmd = parent ? parent.command : '';
  if (/Visual Studio Code|Code Helper|\/Code\b/.test(pcmd)) return 'VS Code';
  if (/iTerm/.test(pcmd)) return 'iTerm';
  if (/Terminal\.app/.test(pcmd)) return 'Terminal.app';
  if (/Warp/.test(pcmd)) return 'Warp';
  if (/(^|\/)(zsh|bash|fish|sh)$|^-(zsh|bash|fish)$/.test(pcmd.split(/\s+/)[0] || '')) {
    return proc && proc.tty ? 'Terminal (' + proc.tty + ')' : 'Shell';
  }
  if (looksLikeClaude(pcmd)) return 'Claude (alt-ajan)';
  if (!pcmd) return proc && proc.tty ? 'Terminal (' + proc.tty + ')' : 'bilinmiyor';
  return path.basename(pcmd.split(/\s+/)[0]);
}

const cwdCache = new Map(); // pid -> cwd (lsof pahali, cache'liyoruz)
function cwdOfPid(pid) {
  if (cwdCache.has(pid)) return cwdCache.get(pid);
  let cwd = null;
  try {
    const out = execFileSync('lsof', ['-a', '-d', 'cwd', '-p', String(pid), '-Fn'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const line = out.split('\n').find((l) => l.startsWith('n'));
    if (line) cwd = line.slice(1);
  } catch {
    /* yoksay */
  }
  cwdCache.set(pid, cwd);
  return cwd;
}

// ---------------------------------------------------------------- ~/.claude/sessions

function readSessionFiles() {
  let files = [];
  try {
    files = fs.readdirSync(SESSIONS_DIR).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  const out = [];
  for (const f of files) {
    const full = path.join(SESSIONS_DIR, f);
    try {
      const raw = JSON.parse(fs.readFileSync(full, 'utf8'));
      raw._file = full;
      raw._fileMtime = fs.statSync(full).mtimeMs;
      if (typeof raw.pid === 'number') out.push(raw);
    } catch {
      /* yarim yazilmis dosya olabilir */
    }
  }
  return out;
}

// ---------------------------------------------------------------- transcript index

let tIndex = { at: 0, bySession: new Map(), all: [] };

function transcriptIndex(maxAgeMs = 4000) {
  if (Date.now() - tIndex.at < maxAgeMs) return tIndex;
  const bySession = new Map();
  const all = [];
  let dirs = [];
  try {
    dirs = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    dirs = [];
  }
  for (const d of dirs) {
    const dir = path.join(PROJECTS_DIR, d.name);
    let entries = [];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.endsWith('.jsonl')) continue;
      const file = path.join(dir, e);
      let st;
      try {
        st = fs.statSync(file);
      } catch {
        continue;
      }
      const rec = { sessionId: e.slice(0, -6), file, mtime: st.mtimeMs, size: st.size, projectDir: d.name };
      bySession.set(rec.sessionId, rec);
      all.push(rec);
    }
  }
  all.sort((a, b) => b.mtime - a.mtime);
  tIndex = { at: Date.now(), bySession, all };
  return tIndex;
}

const tailCache = new Map(); // file -> { mtime, size, data }

function readTranscriptTail(file, mtime, size) {
  const c = tailCache.get(file);
  if (c && c.mtime === mtime && c.size === size) return c.data;
  const data = parseTail(file, size);
  tailCache.set(file, { mtime, size, data });
  if (tailCache.size > 300) tailCache.clear();
  return data;
}

// Kart tek satirda gosterildigi icin markdown gurultusunu ayikla
function plainText(t, limit = 400) {
  const s = String(t)
    .replace(/```[\s\S]*?(```|$)/g, ' ')     // kod bloklari
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')      // basliklar
    .replace(/^\s{0,3}[-*]\s+/gm, '· ')      // madde imleri
    .replace(/\*\*|__|`/g, '')               // kalin / kod isaretleri
    .replace(/\s+/g, ' ')
    .trim();
  return limit === Infinity ? s : s.slice(0, limit);
}

// Claude turu bitirip duz metinle soru sordugunda Claude Code bunu "waiting" diye
// yazmiyor — session dosyasinda sadece "idle" var, kart da "beklemede" gosteriyor.
// Oysa klavye sende. Kod bloklari plainText'te zaten ayiklandigi icin koddaki '?'
// sayilmiyor; sonda liste/secenek varsa diye son cumleye degil son 200 karaktere
// bakiyoruz. Son 14 gunun 60 tur-sonu mesajinda 8'ini yakaladi, hepsi gercek soruydu.
// Kelimeye bakan kural (mi/mu eki, "istersen") denendi: yarisi yanlis eslesti, girmedi.
function asksQuestion(cleanText) {
  return /[?？]/.test(String(cleanText || '').slice(-200));
}

function parseTail(file, size) {
  const info = {
    title: null,
    lastPrompt: null,
    mode: null,
    permissionMode: null,
    lastEventAt: null,
    lastRole: null,
    lastStopReason: null,
    lastText: null,
    asked: false,
    lastTool: null,
    model: null,
    contextTokens: null,
    cwd: null,
    gitBranch: null,
    version: null,
    userTurns: 0,
  };
  let buf;
  try {
    const fd = fs.openSync(file, 'r');
    const start = Math.max(0, size - TAIL_BYTES);
    const len = size - start;
    buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, start);
    fs.closeSync(fd);
    if (start > 0) {
      const nl = buf.indexOf(0x0a);
      buf = nl === -1 ? Buffer.alloc(0) : buf.slice(nl + 1);
    }
  } catch {
    return info;
  }

  for (const line of buf.toString('utf8').split('\n')) {
    if (!line.startsWith('{')) continue;
    let d;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    if (d.cwd) info.cwd = d.cwd;
    if (d.gitBranch) info.gitBranch = d.gitBranch;
    if (d.version) info.version = d.version;

    switch (d.type) {
      case 'ai-title':
        info.title = d.aiTitle || info.title;
        break;
      case 'last-prompt':
        info.lastPrompt = d.lastPrompt || info.lastPrompt;
        break;
      case 'mode':
        info.mode = d.mode || info.mode;
        break;
      case 'permission-mode':
        info.permissionMode = d.permissionMode || info.permissionMode;
        break;
      case 'user': {
        if (d.timestamp) info.lastEventAt = Date.parse(d.timestamp);
        const content = d.message && d.message.content;
        const isToolResult =
          Array.isArray(content) && content.some((c) => c && c.type === 'tool_result');
        info.lastRole = isToolResult ? 'tool_result' : 'user';
        if (!isToolResult && !d.isSidechain) info.userTurns++;
        break;
      }
      case 'assistant': {
        if (d.timestamp) info.lastEventAt = Date.parse(d.timestamp);
        info.lastRole = 'assistant';
        const m = d.message || {};
        info.lastStopReason = m.stop_reason || null;
        if (m.model) info.model = m.model;
        const u = m.usage;
        if (u) {
          const ctx =
            (u.input_tokens || 0) +
            (u.cache_read_input_tokens || 0) +
            (u.cache_creation_input_tokens || 0);
          if (ctx > 0) info.contextTokens = ctx;
        }
        for (const c of m.content || []) {
          if (c.type === 'text' && c.text && c.text.trim()) {
            const clean = plainText(c.text, Infinity);
            info.lastText = clean.slice(0, 400);
            info.asked = asksQuestion(clean);
          }
          if (c.type === 'tool_use') {
            info.lastTool = {
              name: c.name,
              detail:
                (c.input && (c.input.description || c.input.command || c.input.file_path || c.input.pattern || c.input.prompt)) ||
                null,
            };
          }
        }
        break;
      }
      default:
        if (d.timestamp) {
          const ts = Date.parse(d.timestamp);
          if (Number.isFinite(ts) && (!info.lastEventAt || ts > info.lastEventAt)) info.lastEventAt = ts;
        }
    }
  }
  if (info.lastTool && info.lastTool.detail) {
    info.lastTool.detail = String(info.lastTool.detail).replace(/\s+/g, ' ').slice(0, 160);
  }
  return info;
}

// ---------------------------------------------------------------- durum cikarimi

const STATUS_ORDER = { waiting: 0, busy: 1, idle: 2, unknown: 3, ended: 4 };

function deriveStatus(sess, tr, now) {
  // Yeni surumler durumu dogrudan ~/.claude/sessions/<pid>.json icine yaziyor.
  if (sess && sess.status) {
    const s = String(sess.status);
    if (s === 'waiting' || s === 'busy' || s === 'idle') return { status: s, source: 'session-file' };
    return { status: 'unknown', raw: s, source: 'session-file' };
  }
  // Transcript yoksa: surec ayakta ama bu oturumda hic konusma baslamamis
  // (tipik olarak editorun acilista baslattigi bos Claude sureci).
  if (!tr) {
    const age = sess && sess.startedAt ? now - sess.startedAt : Infinity;
    if (age < 2 * 60e3) return { status: 'unknown', source: 'tahmin' };
    return { status: 'idle', empty: true, hintKey: 'no-conversation', source: 'tahmin' };
  }
  // Eski surumler (ornegin VS Code eklentisi) yazmiyor -> transcript'ten tahmin.
  if (!tr.lastEventAt) return { status: 'unknown', source: 'tahmin' };
  const age = now - tr.lastEventAt;
  if (tr.lastRole === 'assistant' && tr.lastStopReason && tr.lastStopReason !== 'tool_use') {
    return { status: age < 90e3 ? 'waiting' : 'idle', source: 'tahmin' };
  }
  if (age < 45e3) return { status: 'busy', source: 'tahmin' };
  if (age < 5 * 60e3 && tr.lastStopReason === 'tool_use') {
    return { status: 'waiting', hintKey: 'maybe-permission', source: 'tahmin' };
  }
  return { status: 'idle', source: 'tahmin' };
}

function projectName(cwd) {
  if (!cwd) return '?';
  return path.basename(cwd) || cwd;
}

function shortPath(cwd) {
  if (!cwd) return '';
  return cwd.startsWith(HOME) ? '~' + cwd.slice(HOME.length) : cwd;
}

// ---------------------------------------------------------------- toplayici

function collect() {
  const now = Date.now();
  const procs = psSnapshot();
  const sessFiles = readSessionFiles();
  const idx = transcriptIndex();

  const live = [];
  const seenPids = new Set();
  const liveSessionIds = new Set();

  for (const s of sessFiles) {
    const proc = procs.get(s.pid);
    const alive = !!proc && looksLikeClaude(proc.command);
    if (!alive) continue; // olu pid -> bayat dosya, atla
    seenPids.add(s.pid);

    const rec = idx.bySession.get(s.sessionId);
    const tr = rec ? readTranscriptTail(rec.file, rec.mtime, rec.size) : null;
    const st = deriveStatus(s, tr, now);
    // Transcript dosyasinin mtime'i mesaj gelmeden de tazelenebiliyor (Claude Code
    // baska satirlar da yaziyor), o yuzden gercek olcut dosyanin icindeki son olay damgasi.
    const lastMessageAt = (tr && tr.lastEventAt) || null;
    const lastActivity =
      lastMessageAt || Math.max(rec ? rec.mtime : 0, s.statusUpdatedAt || s.updatedAt || 0, 0) || null;
    const cold = st.status === 'idle' && (!lastMessageAt || now - lastMessageAt > COLD_MS);

    live.push({
      kind: 'live',
      pid: s.pid,
      sessionId: s.sessionId,
      name: s.name || projectName(s.cwd),
      cwd: s.cwd || (proc ? cwdOfPid(s.pid) : null),
      cwdShort: shortPath(s.cwd),
      project: projectName(s.cwd),
      status: st.status,
      statusRaw: st.raw || null,
      statusSource: st.source,
      cold,
      lastMessageAt,
      empty: !!st.empty,
      // waitingFor Claude Code'un kendi metni (ceviri yok); kendi cikarimlarimiz anahtar olarak gider
      waitingFor: s.waitingFor || null,
      hintKey: st.hintKey || null,
      sessionKind: s.kind || 'interactive',
      entrypoint: s.entrypoint || null,
      version: s.version || (tr && tr.version) || null,
      startedAt: s.startedAt || (proc ? proc.startedAt : null),
      statusUpdatedAt: s.statusUpdatedAt || s.updatedAt || null,
      lastActivityAt: lastActivity,
      host: hostOf(proc, procs),
      tty: proc ? proc.tty : null,
      cpu: proc ? proc.cpu : null,
      rssMb: proc ? proc.rssMb : null,
      socket: s.messagingSocketPath || null,
      transcript: rec ? rec.file : null,
      title: tr && tr.title,
      lastPrompt: tr && tr.lastPrompt,
      lastText: tr && tr.lastText,
      // Claude duz metinle soru sordu mu: session dosyasi bunu bilmiyor, biz cikardik
      asked: !!(tr && tr.asked),
      lastTool: tr && tr.lastTool,
      model: tr && tr.model,
      contextTokens: tr && tr.contextTokens,
      gitBranch: tr && tr.gitBranch,
      permissionMode: tr && tr.permissionMode,
      userTurns: tr ? tr.userTurns : null,
    });
    if (s.sessionId) liveSessionIds.add(s.sessionId);
  }

  // sessions/<pid>.json yazmayan claude surecleri (eski surumler, alt-ajanlar)
  for (const [pid, proc] of procs) {
    if (seenPids.has(pid)) continue;
    if (!looksLikeClaude(proc.command)) continue;
    const cwd = cwdOfPid(pid);
    live.push({
      kind: 'live',
      pid,
      sessionId: null,
      name: projectName(cwd),
      cwd,
      cwdShort: shortPath(cwd),
      project: projectName(cwd),
      status: 'unknown',
      statusSource: 'sadece-process',
      waitingFor: null,
      sessionKind: /--print|-p\b/.test(proc.command) ? 'headless' : 'interactive',
      version: (proc.command.match(/claude-code-([\d.]+)-/) || [])[1] || null,
      startedAt: proc.startedAt,
      lastActivityAt: null,
      host: hostOf(proc, procs),
      tty: proc.tty,
      cpu: proc.cpu,
      rssMb: proc.rssMb,
      note: 'Bu surec durum bilgisi yazmiyor (eski surum ya da alt-surec).',
    });
  }

  live.sort((a, b) => {
    const d = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (d !== 0) return d;
    return (b.lastActivityAt || b.startedAt || 0) - (a.lastActivityAt || a.startedAt || 0);
  });

  // yakin zamanda kapanmis session'lar (resume edilebilir)
  const ended = [];
  for (const rec of idx.all) {
    if (now - rec.mtime > ENDED_WINDOW_MS) break; // mtime'a gore sirali
    if (liveSessionIds.has(rec.sessionId)) continue;
    const tr = readTranscriptTail(rec.file, rec.mtime, rec.size);
    if (!tr.cwd && !tr.title && !tr.lastPrompt) continue;
    ended.push({
      kind: 'ended',
      sessionId: rec.sessionId,
      cwd: tr.cwd,
      cwdShort: shortPath(tr.cwd),
      project: projectName(tr.cwd),
      status: 'ended',
      lastActivityAt: tr.lastEventAt || rec.mtime,
      title: tr.title,
      lastPrompt: tr.lastPrompt,
      model: tr.model,
      gitBranch: tr.gitBranch,
      contextTokens: tr.contextTokens,
      userTurns: tr.userTurns,
      sizeMb: +(rec.size / 1048576).toFixed(1),
      transcript: rec.file,
    });
    if (ended.length >= 25) break;
  }

  const counts = { waiting: 0, busy: 0, ready: 0, idle: 0, unknown: 0 };
  for (const s of live) {
    const k = s.status === 'idle' && !s.cold ? 'ready' : s.status;
    counts[k] = (counts[k] || 0) + 1;
  }

  return { now, live, ended, counts, host: os.hostname(), version: VERSION };
}

// ---------------------------------------------------------------- mesaj gonderme

// Claude Code her session icin (feature gate acikken) bir unix soketi dinler:
//   /tmp/cc-socks/<pid>.sock  <- satir satir JSON
// Buraya yazilan mesaj hedef session'a "baska bir Claude session'i" olarak ulasir.
function sendToSession(pid, text, cb) {
  const sess = readSessionFiles().find((s) => s.pid === pid);
  if (!sess) return cb(new Error('Bu pid icin session kaydi yok'));
  const sock = sess.messagingSocketPath;
  if (!sock) return cb(new Error('Bu session mesajlasmaya acik degil'));
  // yalnizca cc-socks dizini altindaki .sock yollarina yaz
  if (!/(^|\/)cc-socks[^/]*\/[^/]+\.sock$/.test(sock)) return cb(new Error('Beklenmeyen soket yolu'));
  try {
    process.kill(pid, 0); // surec gercekten yasiyor mu
  } catch {
    return cb(new Error('Surec artik yasamiyor'));
  }
  const net = require('net');
  const payload = JSON.stringify({ type: 'user', message: { role: 'user', content: text } }) + '\n';
  let done = false;
  const finish = (err) => {
    if (done) return;
    done = true;
    cb(err || null);
  };
  const c = net.connect(sock, () => c.end(payload));
  c.setTimeout(4000, () => {
    c.destroy();
    finish(new Error('Soket zaman asimi'));
  });
  c.on('error', finish);
  c.on('close', () => finish(null));
}

// ---------------------------------------------------------------- terminal ciktisi

const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m', gray: '\x1b[90m',
};

function rel(ms, now) {
  if (!ms) return '-';
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return s + 'sn';
  if (s < 3600) return Math.round(s / 60) + 'dk';
  if (s < 86400) return Math.round(s / 3600) + 'sa';
  return Math.round(s / 86400) + 'g';
}

const LABEL = {
  waiting: 'INPUT BEKLIYOR',
  busy: 'CALISIYOR',
  ready: 'BEKLEMEDE',
  idle: 'BOSTA',
  unknown: 'BILINMIYOR',
  ended: 'KAPANDI',
};
const COLOR = {
  waiting: C.yellow, busy: C.green, ready: C.cyan,
  idle: C.blue, unknown: C.gray, ended: C.gray,
};
// idle + henuz sogumamis = "beklemede" (Claude cevabini verdi, sira sende)
// asked: tur bitmis ama Claude soru sormus — panelde oldugu gibi burada da input bekliyor sayilir
const dispStatus = (s) => (s.status === 'idle' && !s.cold ? (s.asked ? 'waiting' : 'ready') : s.status);

function printTable(state) {
  const { live, ended, counts, now } = state;
  console.log(
    `\n${C.bold}Claude CLI session'lari${C.reset}  ` +
      `${C.yellow}${counts.waiting || 0} bekliyor${C.reset} · ` +
      `${C.green}${counts.busy || 0} calisiyor${C.reset} · ` +
      `${C.cyan}${counts.ready || 0} beklemede${C.reset} · ` +
      `${C.blue}${counts.idle || 0} bosta${C.reset} · ` +
      `${C.gray}${counts.unknown || 0} bilinmiyor${C.reset}   ` +
      `${C.dim}(toplam ${live.length} canli surec)${C.reset}\n`
  );
  for (const s of live) {
    const ds = dispStatus(s);
    const col = COLOR[ds] || C.gray;
    console.log(
      `${col}●${C.reset} ${C.bold}${(s.project || '?').padEnd(22)}${C.reset}` +
        `${col}${LABEL[ds].padEnd(15)}${C.reset}` +
        `${C.dim}pid ${String(s.pid).padEnd(7)}${(s.host || '').padEnd(20)}` +
        `son hareket ${rel(s.lastActivityAt || s.startedAt, now)} once${C.reset}`
    );
    const sub = s.waitingFor
      ? `${C.yellow}↳ ${s.waitingFor}${C.reset}`
      : s.status === 'busy' && s.lastTool
      ? `${C.dim}↳ ${s.lastTool.name}${s.lastTool.detail ? ': ' + s.lastTool.detail.slice(0, 70) : ''}${C.reset}`
      : s.lastPrompt || s.title
      ? `${C.dim}↳ ${s.lastPrompt || s.title}${C.reset}`
      : null;
    if (sub) console.log('  ' + sub);
    console.log(`  ${C.gray}${shortPath(s.cwd)}${s.gitBranch ? ' @' + s.gitBranch : ''}${C.reset}`);
  }
  if (ended.length) {
    console.log(`\n${C.dim}— son kapanan session'lar (claude --resume ile devam) —${C.reset}`);
    for (const s of ended.slice(0, 8)) {
      console.log(
        `${C.gray}○ ${(s.project || '?').padEnd(22)}${rel(s.lastActivityAt, now).padStart(4)} once  ` +
          `${(s.title || s.lastPrompt || '').slice(0, 60)}${C.reset}`
      );
    }
  }
  console.log('');
}

// ---------------------------------------------------------------- http sunucu

const INDEX_FILE = path.join(__dirname, 'index.html');

function serve() {
  const clients = new Set();

  const server = http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    if (url === '/' || url === '/index.html') {
      fs.readFile(INDEX_FILE, (err, buf) => {
        if (err) {
          res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
          res.end('index.html bulunamadi: ' + INDEX_FILE);
          return;
        }
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(buf);
      });
      return;
    }
    const JS = 'application/javascript; charset=utf-8';
    const PNG = 'image/png';
    const STATIC = {
      '/office.js': JS,
      '/office3d.js': JS,
      '/sw.js': JS,
      '/vendor/three.module.min.js': JS,
      '/vendor/three.core.min.js': JS,
      '/office.css': 'text/css; charset=utf-8',
      '/offline.html': 'text/html; charset=utf-8',
      '/manifest.webmanifest': 'application/manifest+json; charset=utf-8',
      '/icons/icon-192.png': PNG,
      '/icons/icon-512.png': PNG,
      '/icons/icon-maskable-512.png': PNG,
      '/icons/apple-touch-icon.png': PNG,
      '/favicon.ico': PNG,
    };
    if (STATIC[url]) {
      const rel = url === '/favicon.ico' ? 'icons/icon-192.png' : url.slice(1);
      fs.readFile(path.join(__dirname, ...rel.split('/')), (err, buf) => {
        if (err) {
          res.writeHead(404, { 'content-type': 'text/plain' });
          res.end('yok');
          return;
        }
        const head = { 'content-type': STATIC[url], 'cache-control': 'no-cache' };
        if (url === '/sw.js') head['service-worker-allowed'] = '/';
        res.writeHead(200, head);
        res.end(buf);
      });
      return;
    }
    if (url === '/api/state') {
      const body = JSON.stringify(collect());
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(body);
      return;
    }
    if (url === '/api/send' && req.method === 'POST') {
      // baska bir sitenin tarayicidan localhost'a POST atmasini engelle
      const origin = req.headers.origin;
      if (origin && !/^http:\/\/(localhost|127\.0\.0\.1):/.test(origin)) {
        res.writeHead(403, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'origin reddedildi' }));
        return;
      }
      let body = '';
      let tooBig = false;
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > 64 * 1024) {
          tooBig = true;
          req.destroy();
        }
      });
      req.on('end', () => {
        if (tooBig) return;
        const reply = (code, obj) => {
          res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify(obj));
        };
        let d;
        try {
          d = JSON.parse(body);
        } catch {
          return reply(400, { ok: false, error: 'gecersiz JSON' });
        }
        const pid = parseInt(d.pid, 10);
        const text = typeof d.text === 'string' ? d.text.trim() : '';
        if (!pid || !text) return reply(400, { ok: false, error: 'pid ve text gerekli' });
        sendToSession(pid, text, (err) => {
          if (err) return reply(409, { ok: false, error: err.message });
          reply(200, { ok: true });
        });
      });
      return;
    }
    if (url === '/events') {
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      res.write('retry: 3000\n\n');
      res.write('data: ' + JSON.stringify(collect()) + '\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('yok');
  });

  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.error(`\n  Port ${PORT} dolu. Zaten acik olabilir: http://localhost:${PORT}`);
      console.error(`  Baska port icin: node server.js --port 7799\n`);
      process.exit(1);
    }
    throw e;
  });

  server.listen(PORT, '127.0.0.1', () => {
    const url = `http://localhost:${PORT}`;
    console.log(`\n  ccwatch calisiyor -> ${url}`);
    console.log(`  durdurmak icin Ctrl+C\n`);
    if (!hasFlag('--no-open')) {
      try {
        spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
      } catch {
        /* yoksay */
      }
    }
  });

  // Electron uygulamasi bizi cocuk surec olarak baslattiysa: o olurse biz de olelim.
  // Duzgun cikista zaten kill ediliyoruz, bu sadece cokme/SIGKILL icin. launchd ile
  // baslatilan sunucunun ppid'i bastan 1 oldugu icin bu yol yalniz env ile aciliyor.
  if (process.env.CCWATCH_SUPERVISED === '1') {
    setInterval(() => {
      if (process.ppid === 1) process.exit(0);
    }, 4000).unref?.();
  }

  setInterval(() => {
    if (!clients.size) return;
    let payload;
    try {
      payload = 'data: ' + JSON.stringify(collect()) + '\n\n';
    } catch (e) {
      return;
    }
    for (const res of clients) {
      try {
        res.write(payload);
      } catch {
        clients.delete(res);
      }
    }
  }, 2000).unref?.();
}


// ---------------------------------------------------------------- launchd (macOS)
// Panel bir dock ikonu haline gelince "sunucuyu da ayrica baslat" adimi sirittigi icin:
// acilista kendiliginden kalksin, cokerse geri gelsin.

const AGENT_LABEL = 'com.github.ferhatural.ccwatch';
const AGENT_PLIST = path.join(HOME, 'Library', 'LaunchAgents', AGENT_LABEL + '.plist');
const AGENT_LOG = path.join(HOME, 'Library', 'Logs', 'ccwatch.log');

const sh = (cmd, args) => {
  try {
    return { ok: true, out: execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    return { ok: false, out: String((e.stderr || e.stdout || e.message) || '').trim() };
  }
};

function agentPlist() {
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const args = [process.execPath, __filename, '--port', String(PORT), '--no-open'];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args.map((a) => '    <string>' + esc(a) + '</string>').join('\n')}
  </array>
  <key>WorkingDirectory</key><string>${esc(__dirname)}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/opt/homebrew/bin</string>
  </dict>
  <key>StandardOutPath</key><string>${esc(AGENT_LOG)}</string>
  <key>StandardErrorPath</key><string>${esc(AGENT_LOG)}</string>
</dict>
</plist>
`;
}

function installAgent() {
  if (process.platform !== 'darwin') {
    console.error('\n  --install yalnizca macOS icin (launchd). Linux icin systemd --user birimi gerekiyor.\n');
    process.exit(1);
  }
  // npx onbelleginden kurulursa yol bir sure sonra silinip agent kirilir
  if (/[\/\\]_npx[\/\\]/.test(__dirname)) {
    console.error('\n  ccwatch su an npx gecici onbelleginden calisiyor:');
    console.error('    ' + __dirname);
    console.error('  Bu klasor temizlenince acilistaki servis kirilir. Once kalici kur:\n');
    console.error('    npm i -g ccwatch && ccwatch --install\n');
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(AGENT_PLIST), { recursive: true });
  fs.mkdirSync(path.dirname(AGENT_LOG), { recursive: true });
  fs.writeFileSync(AGENT_PLIST, agentPlist());

  const target = 'gui/' + process.getuid();
  sh('launchctl', ['bootout', target + '/' + AGENT_LABEL]);      // varsa eskisini indir
  let r = sh('launchctl', ['bootstrap', target, AGENT_PLIST]);
  if (!r.ok) r = sh('launchctl', ['load', '-w', AGENT_PLIST]);   // eski macOS
  if (!r.ok) {
    console.error('\n  launchctl yuklenemedi:\n  ' + r.out + '\n');
    process.exit(1);
  }
  console.log('\n  ccwatch acilista otomatik baslayacak.');
  console.log('  plist : ' + AGENT_PLIST);
  console.log('  log   : ' + AGENT_LOG);
  console.log('  panel : http://localhost:' + PORT);
  console.log('\n  kaldirmak icin: ccwatch --uninstall\n');
}

function uninstallAgent() {
  const target = 'gui/' + process.getuid();
  const r = sh('launchctl', ['bootout', target + '/' + AGENT_LABEL]);
  if (!r.ok) sh('launchctl', ['unload', '-w', AGENT_PLIST]);
  try { fs.unlinkSync(AGENT_PLIST); } catch { /* zaten yok */ }
  console.log('\n  ccwatch acilis servisi kaldirildi.\n');
}

function agentStatus() {
  const installed = fs.existsSync(AGENT_PLIST);
  const r = sh('launchctl', ['print', 'gui/' + process.getuid() + '/' + AGENT_LABEL]);
  const pid = (r.out.match(/\bpid = (\d+)/) || [])[1];
  console.log('\n  plist    : ' + (installed ? AGENT_PLIST : 'kurulu degil'));
  console.log('  launchd  : ' + (r.ok ? (pid ? 'calisiyor (pid ' + pid + ')' : 'yuklu, calismyor') : 'yuklu degil'));
  console.log('  panel    : http://localhost:' + PORT);
  console.log('  log      : ' + AGENT_LOG + '\n');
}

// ---------------------------------------------------------------- giris

if (hasFlag('--install')) {
  installAgent();
} else if (hasFlag('--uninstall')) {
  uninstallAgent();
} else if (hasFlag('--status')) {
  agentStatus();
} else if (hasFlag('--json')) {
  console.log(JSON.stringify(collect(), null, 2));
} else if (hasFlag('--once')) {
  printTable(collect());
} else if (hasFlag('--watch')) {
  const tick = () => {
    process.stdout.write('\x1b[2J\x1b[H');
    printTable(collect());
  };
  tick();
  setInterval(tick, 2000);
} else {
  serve();
}
