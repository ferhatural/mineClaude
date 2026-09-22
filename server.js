#!/usr/bin/env node
'use strict';
/**
 * mineClaude - bu makinedeki tum Claude Code (CLI) session'larini canli izler.
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
let SftpClient = null;
try {
  SftpClient = require('ssh2-sftp-client');
} catch {
  /* paket kurulu degilse gorevlerin SFTP senkronu sessizce devre disi kalir */
}

const HOME = os.homedir();
const CLAUDE_DIR = path.join(HOME, '.claude');
const SESSIONS_DIR = path.join(CLAUDE_DIR, 'sessions');
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');
// Proje basina kucuk bir not (mesela musteri istekleri) — cwd -> metin. Session'lar
// gelip gecer ama proje kalici oldugu icin session'a degil klasor yoluna bagliyoruz.
const NOTES_FILE = path.join(CLAUDE_DIR, 'mineclaude-notes.json');

const argv = process.argv.slice(2);
const hasFlag = (f) => argv.includes(f);
const flagValue = (f, d) => {
  const i = argv.indexOf(f);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : d;
};

const PORT = parseInt(flagValue('--port', process.env.MINECLAUDE_PORT || '7788'), 10);
// Terminaller acikca istenmeli. Panel zararsiz bir izleyici; ayni surece kabuk
// dagitma yetenegi eklemek ayri bir karar, yanlislikla acik kalmasin.
const TERMINALS = hasFlag('--terminals');
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

// `ps` yalniz macOS/Linux'ta calisiyor (Windows'ta Git Bash'in ps'i BSD bayraklarini
// desteklemiyor, psSnapshot() bos donuyor). O durumda tek elimizdeki bilgi pid'in
// hala yasiyor olmasi; session dosyasini zaten claude kendisi yazdigi icin yeterli.
function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function psSnapshot() {
  const map = new Map();
  // Windows'ta BSD tipi `ps -axo` yok (Git Bash'inki de dahil): deneyip her seferinde
  // hata mesaji basmak yerine hic denemiyoruz, alive kontrolu pidAlive()'a kaliyor.
  if (process.platform === 'win32') return map;
  let out = '';
  try {
    out = execFileSync('ps', ['-axo', 'pid=,ppid=,tty=,%cpu=,rss=,lstart=,command='], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
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

// Yan panelde tum konusma gosteriliyor. Bunu 2 saniyede bir herkese akan
// /api/state'e koymuyoruz: her session icin kilobaytlarca metin demek olurdu.
// Panel acildiginda tek session icin buradan isteniyor.
const MSG_CHARS = 6000;

// TAIL_BYTES kisayolunu kullanmiyor: bir attachment/tool-sonucu tesadufen
// 192KB'tan buyukse gercek konusma dosyanin basinda kalip tail penceresinin
// disinda kalabiliyordu (kisa bir "selam" sonrasi buyuk bir ek geldiginde
// oldugu gibi) — o zaman gercekten konusulmus olsa da "mesaj bulunamadi"
// gorunuyordu. Butun dosyayi okuyup taramak bunu kokten cozuyor.
function lastMessages(file) {
  const out = [];
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return out;
  }
  for (const line of raw.split('\n')) {
    if (!line.startsWith('{')) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    const m = e.message;
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue;
    // Tool sonuclari da "user" rolunde geliyor; konusma degil, atlanacak
    let text = '';
    if (typeof m.content === 'string') text = m.content;
    else for (const c of m.content || []) if (c.type === 'text' && c.text) text += (text ? '\n\n' : '') + c.text;
    text = text.trim();
    if (!text) continue;
    if (m.role === 'user' && /^<(command-name|local-command|system-reminder)/.test(text)) continue;
    out.push({ role: m.role, text: text.slice(0, MSG_CHARS), at: e.timestamp ? Date.parse(e.timestamp) : null });
  }
  return out;
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
              // SendMessage'in alicisi: ofis gorunumu bir session'in digerine
              // gidisini ancak bununla eslestirebiliyor. `to` hedefin session adi
              // ('ccwatch-24'), yani asagidaki `name` alaniyla birebir ayni sey.
              // id de cagriyi tekilleyip ayni mesaji tekrar tekrar oynatmiyor:
              // lastTool her poll'da ayni gelir, "yeni mi" sorusunun cevabi bu.
              to: c.name === 'SendMessage' && c.input ? c.input.to || null : null,
              id: c.id || null,
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
    const status = s === 'waiting' || s === 'busy' || s === 'idle' ? s : 'unknown';
    // Bu alan "hic konusma olmadi" bilgisini tasimiyor, o yuzden onu ayrica
    // transcript yoklugundan cikariyoruz — ama yalniz calismiyorken (idle/unknown)
    // anlamli: busy/waiting zaten kullanimda oldugunu kaniti.
    if ((status === 'idle' || status === 'unknown') && !tr) {
      const age = sess.startedAt ? now - sess.startedAt : Infinity;
      if (age >= 2 * 60e3) return { status: 'idle', empty: true, hintKey: 'no-conversation', source: 'session-file' };
    }
    return { status, raw: status === 'unknown' ? s : undefined, source: 'session-file' };
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

// Once tum projelerin gorevleri tek bir merkezi dosyada (~/.claude altinda)
// tutuluyordu. Artik her proje kendi gorevlerini kendi klasorunde saklıyor —
// proje kopyalanip tasinsa ya da baska bir makineden acilsa bile gorevler
// projeyle birlikte geliyor.
function tasksFileFor(cwd) {
  return path.join(cwd, '.mineclaude', 'tasks.json');
}

function loadLegacyNotes() {
  try {
    return JSON.parse(fs.readFileSync(NOTES_FILE, 'utf8'));
  } catch {
    return {};
  }
}

// Eskiden burada proje basina tek bir metin (tek "not") tutuluyordu. Musteri
// istekleri tek seferde 5-10 is birden birikince o tek kutu yetmiyordu; artik
// her cwd bir gorev listesi: [{id, text, done}].
function notesForLocal(cwd) {
  try {
    const raw = JSON.parse(fs.readFileSync(tasksFileFor(cwd), 'utf8'));
    if (Array.isArray(raw)) return raw;
  } catch {
    /* proje klasorunde henuz dosya yok: eski merkezi kayda bak */
  }
  const legacy = loadLegacyNotes()[cwd];
  if (Array.isArray(legacy)) return legacy;
  if (typeof legacy === 'string' && legacy) return [{ id: 'legacy', text: legacy, done: false }];
  return [];
}

function notesFor(cwd) {
  const sftp = sftpConfigFor(cwd);
  return sftp ? notesForSftp(cwd, sftp) : notesForLocal(cwd);
}

function saveTasks(cwd, tasks) {
  const file = tasksFileFor(cwd);
  if (tasks.length) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(tasks, null, 2));
  } else {
    fs.rmSync(file, { force: true });
  }
  // Bu proje artik kendi klasorunde tutuluyor. Eski merkezi kayittaki girdisi
  // silinmeden kalsaydi, tum gorevler silinip proje dosyasi kaldirilinca
  // notesFor() tekrar oraya dusup eski (silinmis) gorevleri geri getiriyordu.
  const legacy = loadLegacyNotes();
  if (cwd in legacy) {
    delete legacy[cwd];
    fs.mkdirSync(path.dirname(NOTES_FILE), { recursive: true });
    fs.writeFileSync(NOTES_FILE, JSON.stringify(legacy, null, 2));
  }

  // Proje klasorunde .vscode/sftp.json varsa (VS Code SFTP eklentisinin deploy
  // ayari), gorevleri o sunucuya da yaziyoruz. Boylece ayni sftp.json'a (ayni
  // host+remotePath) sahip baska bir bilgisayar da ayni gorev listesini gorur.
  const sftp = sftpConfigFor(cwd);
  if (sftp) {
    const entry = sftpTaskCache.get(cwd) || {};
    entry.tasks = tasks;
    entry.fetchedAt = Date.now(); // az once biz yazdik, hemen tekrar okumaya gerek yok
    sftpTaskCache.set(cwd, entry);
    uploadRemoteTasks(sftp, tasks).catch((e) =>
      console.error('[mineClaude] sftp gorev yazma hatasi (' + cwd + '):', e.message || e));
  }
}

// ---------------------------------------------------------------- gorevlerin SFTP senkronu
//
// sftp.json her makinede farkli bir yerel proje yoluna karsilik gelebilir (ornek:
// C:\Users\hakan\Projects\DSMG ile C:\Users\ahmet\proje\dsmg), ama ikisi de ayni
// host+remotePath'a isaret ediyorsa ayni uzak tasks.json'u okuyup yazarlar — ekstra
// bir eslesme/merkezi servise gerek yok, zaten var olan deploy ayarini kullaniyoruz.

const SFTP_POLL_MS = 8000; // baska bir bilgisayarin yazdigini bu araliklarla yoklariz
const sftpTaskCache = new Map(); // cwd -> { tasks, fetchedAt, fetching }

function sftpConfigFor(cwd) {
  if (!SftpClient) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(cwd, '.vscode', 'sftp.json'), 'utf8'));
    if (!raw || !raw.host || !raw.username || !raw.remotePath) return null;
    return {
      host: raw.host,
      port: raw.port || 22,
      username: raw.username,
      password: raw.password,
      privateKey: raw.privateKeyPath ? fs.readFileSync(raw.privateKeyPath) : undefined,
      remoteDir: String(raw.remotePath).replace(/\/+$/, '') + '/.mineclaude',
    };
  } catch {
    return null; // sftp.json yok ya da bozuk: sessizce yerel dosyaya duser
  }
}

async function withSftp(cfg, fn) {
  const client = new SftpClient();
  try {
    await client.connect({
      host: cfg.host,
      port: cfg.port,
      username: cfg.username,
      password: cfg.password,
      privateKey: cfg.privateKey,
    });
    return await fn(client);
  } finally {
    try {
      await client.end();
    } catch {
      /* baglanti zaten kopmus olabilir */
    }
  }
}

async function fetchRemoteTasks(cfg) {
  return withSftp(cfg, async (client) => {
    try {
      const buf = await client.get(cfg.remoteDir + '/tasks.json');
      const raw = JSON.parse(buf.toString('utf8'));
      return Array.isArray(raw) ? raw : [];
    } catch (e) {
      // dosya henuz yok (bu proje icin ilk kullanim) -> bos liste, hata degil
      if (/no such file|not exist/i.test(String(e.message || e))) return [];
      throw e;
    }
  });
}

async function uploadRemoteTasks(cfg, tasks) {
  return withSftp(cfg, async (client) => {
    await client.mkdir(cfg.remoteDir, true);
    await client.put(Buffer.from(JSON.stringify(tasks, null, 2)), cfg.remoteDir + '/tasks.json');
  });
}

// collect() ve /api/note gibi senkron yollardan cagriliyor: agi burada bekleyemeyiz.
// Elimizdeki en son bilinen listeyi hemen donup arka planda tazeliyoruz.
function notesForSftp(cwd, cfg) {
  let entry = sftpTaskCache.get(cwd);
  if (!entry) {
    entry = { tasks: notesForLocal(cwd), fetchedAt: 0, fetching: false };
    sftpTaskCache.set(cwd, entry);
  }
  if (!entry.fetching && Date.now() - entry.fetchedAt > SFTP_POLL_MS) {
    entry.fetching = true;
    fetchRemoteTasks(cfg)
      .then((tasks) => {
        entry.tasks = tasks;
        entry.fetchedAt = Date.now();
      })
      .catch((e) => console.error('[mineClaude] sftp gorev okuma hatasi (' + cwd + '):', e.message || e))
      .finally(() => {
        entry.fetching = false;
      });
  }
  return entry.tasks;
}

// "Tum gorevler" penceresi sadece o an canli oturumlarla sinirli olursa, gorevi
// olan ama su an calisan bir sureci bulunmayan (ya da uzun zaman once kapanmis)
// projeler hic gorunmuyordu. Bunun yerine mineClaude'un gordugu HER projeyi
// (transcript index) tarayip gorevi olanlari donuyoruz — oturum durumundan
// bagimsiz. Proje klasoru basina en yeni transcript'e bakmak yeterli: hepsini
// tek tek acmaya gerek yok.
function allProjectTasks() {
  const idx = transcriptIndex();
  const byProjectDir = new Map();
  for (const rec of idx.all) {
    // idx.all mtime'a gore siralı: bir proje dizini icin ilk gorulen en yenisi
    if (!byProjectDir.has(rec.projectDir)) byProjectDir.set(rec.projectDir, rec);
  }
  const out = [];
  const seenCwd = new Set();
  for (const rec of byProjectDir.values()) {
    const tr = readTranscriptTail(rec.file, rec.mtime, rec.size);
    if (!tr.cwd || seenCwd.has(tr.cwd)) continue;
    seenCwd.add(tr.cwd);
    const tasks = notesFor(tr.cwd);
    if (tasks.length) out.push({ cwd: tr.cwd, project: projectName(tr.cwd), tasks });
  }
  return out;
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
    const alive = proc ? looksLikeClaude(proc.command) : pidAlive(s.pid);
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

  for (const s of live) s.projectTasks = s.cwd ? notesFor(s.cwd) : [];
  for (const s of ended) s.projectTasks = s.cwd ? notesFor(s.cwd) : [];

  return { now, live, ended, counts, host: os.hostname(), version: VERSION };
}

// ---------------------------------------------------------------- mesaj gonderme

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

// ---------------------------------------------------------------- terminaller (istege bagli)

// Tarayicidan terminal: PTY bu surecte yasiyor, cizim tarayicida. Electron
// yolundaki IPC'nin WebSocket karsiligi — mesaj sekli birebir ayni, term.js
// hangi tasima varsa onu kullaniyor.
//
// Sunucu yalnizca 127.0.0.1 dinliyor; disaridan erisim SSH tuneli ya da benzeri
// bir ozel ag uzerinden olmali. Burada kimlik dogrulamasi yok, oldugunu da
// varsaymayin.
function attachTerminals(server) {
  if (!TERMINALS) return;
  let WebSocketServer, term;
  try {
    ({ WebSocketServer } = require('ws'));
    term = require('./pty');
  } catch (e) {
    console.error('  terminaller acilamadi: ' + String(e.message || e).split('\n')[0]);
    console.error('  gerekli: npm i ws node-pty\n');
    return;
  }
  if (!term.available()) {
    console.error('  terminaller acilamadi: node-pty yok (' + (term.loadError() || '') + ')\n');
    return;
  }

  const wss = new WebSocketServer({ server, path: '/terminals' });
  wss.on('connection', (ws) => {
    const mine = new Set();
    const send = (m) => { if (ws.readyState === 1) ws.send(JSON.stringify(m)); };

    ws.on('message', (raw) => {
      let m;
      try { m = JSON.parse(raw); } catch { return; }
      if (m.t === 'create') {
        let info;
        try {
          info = term.create({
            cwd: m.cwd, cols: m.cols, rows: m.rows,
            command: m.command, resumeSessionId: m.resumeSessionId,
            light: !!m.light,
          });
        } catch (e) {
          return send({ t: 'error', ref: m.ref, error: String(e.message || e) });
        }
        mine.add(info.id);
        term.attach(info.id, (id, data) => send({ t: 'data', id, data }), (id, code) => send({ t: 'exit', id, code }));
        send({ t: 'created', ref: m.ref, ...info });
      } else if (m.t === 'attach') {
        // Baglanti koptu, PTY yasiyor. Yeni baglantiya geri baglamak: tunel
        // duserse ya da tablet uykuya dalarsa oturum kaybolmasin.
        const live = term.list().find((x) => x.id === m.id && !x.dead);
        if (!live) return send({ t: 'gone', id: m.id });
        mine.add(m.id);
        term.attach(m.id, (id, data) => send({ t: 'data', id, data }), (id, code) => send({ t: 'exit', id, code }));
        send({ t: 'attached', ref: m.ref, ...live });
      } else if (m.t === 'write' && mine.has(m.id)) {
        term.write(m.id, m.data);
      } else if (m.t === 'resize' && mine.has(m.id)) {
        term.resize(m.id, m.cols, m.rows);
      } else if (m.t === 'kill' && mine.has(m.id)) {
        term.kill(m.id);
        mine.delete(m.id);
      }
    });

    // Baglanti kopunca PTY'leri birakmiyoruz: tablet uykuya daldi diye Claude
    // oturumu olmesin. Sekmeler yeniden baglandiginda listeden geri bulunuyor.
    ws.on('close', () => { /* PTY'ler yasamaya devam eder */ });
  });

  console.log('  terminaller acik  -> ws://127.0.0.1:' + PORT + '/terminals');
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
      '/term.js': JS,
      '/vendor/xterm.module.js': JS,
      '/vendor/xterm-addon-fit.module.js': JS,
      '/vendor/xterm-addon-search.module.js': JS,
      '/vendor/xterm.css': 'text/css; charset=utf-8',
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
    if (url === '/api/terminals') {
      let list = [];
      if (TERMINALS) {
        try { list = require('./pty').list(); } catch { list = []; }
      }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ enabled: TERMINALS, terminals: list }));
      return;
    }
    if (url === '/api/all-tasks') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ projects: allProjectTasks() }));
      return;
    }
    if (url === '/api/messages') {
      const id = new URL(req.url, 'http://x').searchParams.get('session') || '';
      const reply = (code, obj) => {
        res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        res.end(JSON.stringify(obj));
      };
      // sessionId dosya adina donusuyor: kalibina uymayani diske hic sormayalim
      if (!/^[A-Za-z0-9-]{6,80}$/.test(id)) return reply(400, { error: 'gecersiz session' });
      const rec = transcriptIndex().bySession.get(id);
      if (!rec) return reply(404, { error: 'transcript yok' });
      try {
        return reply(200, { sessionId: id, messages: lastMessages(rec.file) });
      } catch (e) {
        return reply(500, { error: String(e.message || e) });
      }
    }
    if (url === '/api/note' && req.method === 'GET') {
      const cwd = new URL(req.url, 'http://x').searchParams.get('cwd') || '';
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ tasks: cwd ? notesFor(cwd) : [] }));
      return;
    }
    if (url === '/api/note' && req.method === 'POST') {
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
        if (body.length > 16 * 1024) {
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
        const cwd = typeof d.cwd === 'string' ? d.cwd.trim() : '';
        if (!cwd) return reply(400, { ok: false, error: 'cwd gerekli' });
        if (!Array.isArray(d.tasks)) return reply(400, { ok: false, error: 'tasks gerekli' });
        // istemci her degisiklikte tum listeyi gonderiyor: burada da sadece
        // sekli dogrulayip oldugu gibi yaziyoruz, 50 madde / 300 karakter sinirinda.
        const tasks = [];
        for (const t of d.tasks) {
          if (!t || typeof t.text !== 'string') continue;
          const text = t.text.trim().slice(0, 300);
          if (!text) continue;
          tasks.push({ id: typeof t.id === 'string' ? t.id.slice(0, 64) : String(tasks.length), text, done: !!t.done });
          if (tasks.length >= 50) break;
        }
        try {
          saveTasks(cwd, tasks);
          reply(200, { ok: true });
        } catch (e) {
          reply(500, { ok: false, error: String(e.message || e) });
        }
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

  attachTerminals(server);

  server.listen(PORT, '127.0.0.1', () => {
    const url = `http://localhost:${PORT}`;
    console.log(`\n  mineClaude calisiyor -> ${url}`);
    console.log(`  durdurmak icin Ctrl+C\n`);
    if (!hasFlag('--no-open')) {
      // macOS'ta `open`, Linux'ta `xdg-open`, Windows'ta cmd'nin dahili `start`
      // komutu (ayri bir exe degil, o yuzden `cmd /c` ile). start'in ilk tirnakli
      // argumani pencere basligi sayiliyor; bos gecmezsek URL'yi baslik sanip
      // tarayiciyi hic acmiyor.
      const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
      try {
        const child =
          process.platform === 'win32'
            ? spawn('cmd', ['/c', 'start', '""', url], { stdio: 'ignore', detached: true, windowsHide: true })
            : spawn(opener, [url], { stdio: 'ignore', detached: true });
        // Baslikli bir masaustu yoksa (sunucu, konteyner, ssh) xdg-open kurulu
        // olmayabilir. Sunucu ayakta kalsin, kullanici da adresi kendi acsin.
        child.on('error', () => {
          console.error(`  tarayici acilamadi (${opener} yok) - yukaridaki adresi elle ac`);
        });
        child.unref();
      } catch {
        /* yoksay */
      }
    }
  });

  // Electron uygulamasi bizi cocuk surec olarak baslattiysa: o olurse biz de olelim.
  // Duzgun cikista zaten kill ediliyoruz, bu sadece cokme/SIGKILL icin. launchd ile
  // baslatilan sunucunun ppid'i bastan 1 oldugu icin bu yol yalniz env ile aciliyor.
  if (process.env.MINECLAUDE_SUPERVISED === '1') {
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

const AGENT_LABEL = 'com.github.ferhatural.mineclaude';
const AGENT_PLIST = path.join(HOME, 'Library', 'LaunchAgents', AGENT_LABEL + '.plist');
const AGENT_LOG = path.join(HOME, 'Library', 'Logs', 'mineclaude.log');

const sh = (cmd, args) => {
  try {
    return { ok: true, out: execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    return { ok: false, out: String((e.stderr || e.stdout || e.message) || '').trim() };
  }
};

function agentPlist() {
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // --install --terminals ile kurulduysa bayrak servise de islensin: disaridan
  // baglanan bir tablet icin terminallerin acilista hazir olmasi gerekiyor.
  const args = [process.execPath, __filename, '--port', String(PORT), '--no-open'];
  if (TERMINALS) args.push('--terminals');
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
    console.error('\n  mineClaude su an npx gecici onbelleginden calisiyor:');
    console.error('    ' + __dirname);
    console.error('  Bu klasor temizlenince acilistaki servis kirilir. Once kalici kur:\n');
    console.error('    npm i -g mineclaude && mineclaude --install\n');
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
  console.log('\n  mineClaude acilista otomatik baslayacak.');
  console.log('  plist : ' + AGENT_PLIST);
  console.log('  log   : ' + AGENT_LOG);
  console.log('  panel : http://localhost:' + PORT);
  console.log('  terminaller : ' + (TERMINALS ? 'acik' : 'kapali (--install --terminals ile acilir)'));
  console.log('\n  kaldirmak icin: mineclaude --uninstall\n');
}

function uninstallAgent() {
  const target = 'gui/' + process.getuid();
  const r = sh('launchctl', ['bootout', target + '/' + AGENT_LABEL]);
  if (!r.ok) sh('launchctl', ['unload', '-w', AGENT_PLIST]);
  try { fs.unlinkSync(AGENT_PLIST); } catch { /* zaten yok */ }
  console.log('\n  mineClaude acilis servisi kaldirildi.\n');
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

// ---------------------------------------------------------------- gorevler (CLI)
//
// Gorevler zaten projenin kendi klasorunde (<cwd>/.mineclaude/tasks.json) ve
// panel her anketinde dosyayi taze okuyor. Yani o projede calisan bir Claude
// oturumu listeyi dogrudan yonetebilir; eksik olan tek sey elle JSON kurcalamadan
// yazmanin yoluydu. Varsayilan klasor process.cwd(): oturum zaten proje icinde
// oldugu icin yol vermeye gerek kalmiyor.

let taskUid = 0;
const newTaskId = () => 'n' + Date.now() + '-' + (taskUid++);

function taskCwd() {
  return path.resolve(flagValue('--cwd', process.cwd()));
}

// Claude'un id'leri aklinda tutmasi gerekmesin: metin parcasiyla da eslesiyor.
function findTask(tasks, ref) {
  const byId = tasks.find((t) => t.id === ref);
  if (byId) return byId;
  const alt = ref.toLowerCase();
  const eslesen = tasks.filter((t) => t.text.toLowerCase().includes(alt));
  if (eslesen.length > 1) return { belirsiz: eslesen };
  return eslesen[0] || null;
}

function printTasks(cwd, tasks) {
  console.log('\n  ' + projectName(cwd) + '  ' + cwd);
  if (!tasks.length) {
    console.log('  (gorev yok)\n');
    return;
  }
  for (const t of tasks) console.log(`  ${t.done ? '[x]' : '[ ]'} ${t.text}   \x1b[2m${t.id}\x1b[0m`);
  console.log('');
}

function taskCommand(kind, arg) {
  const cwd = taskCwd();
  if (!fs.existsSync(cwd)) {
    console.error(`  klasor yok: ${cwd}`);
    process.exitCode = 1;
    return;
  }
  const tasks = notesFor(cwd);

  if (kind === 'list') return printTasks(cwd, tasks);

  if (!arg) {
    console.error('  metin eksik. ornek: mineclaude --task-add "testleri yaz"');
    process.exitCode = 1;
    return;
  }

  if (kind === 'add') {
    const text = arg.trim().slice(0, 500);
    if (!text) {
      console.error('  bos gorev eklenmez');
      process.exitCode = 1;
      return;
    }
    tasks.push({ id: newTaskId(), text, done: false });
    saveTasks(cwd, tasks);
    console.log(`  + ${text}`);
    return printTasks(cwd, tasks);
  }

  const hedef = findTask(tasks, arg);
  if (!hedef) {
    console.error(`  eslesen gorev yok: ${arg}`);
    process.exitCode = 1;
    return;
  }
  if (hedef.belirsiz) {
    console.error(`  ${hedef.belirsiz.length} gorev esletti, hangisi belli degil:`);
    for (const t of hedef.belirsiz) console.error(`    ${t.id}  ${t.text}`);
    process.exitCode = 1;
    return;
  }

  if (kind === 'done' || kind === 'undone') {
    hedef.done = kind === 'done';
    saveTasks(cwd, tasks);
    console.log(`  ${hedef.done ? '[x]' : '[ ]'} ${hedef.text}`);
  } else if (kind === 'rm') {
    tasks.splice(tasks.indexOf(hedef), 1);
    saveTasks(cwd, tasks);
    console.log(`  - ${hedef.text}`);
  }
  printTasks(cwd, tasks);
}

// ---------------------------------------------------------------- giris

if (hasFlag('--tasks')) {
  taskCommand('list');
} else if (hasFlag('--task-add')) {
  taskCommand('add', flagValue('--task-add', ''));
} else if (hasFlag('--task-done')) {
  taskCommand('done', flagValue('--task-done', ''));
} else if (hasFlag('--task-undone')) {
  taskCommand('undone', flagValue('--task-undone', ''));
} else if (hasFlag('--task-rm')) {
  taskCommand('rm', flagValue('--task-rm', ''));
} else if (hasFlag('--install')) {
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
