'use strict';
// Gomulu terminaller. Her sekme bir PTY, PTY'ler bu surecte yasiyor.
//
// Neden gercek bir PTY: Claude Code'un arayuzu bir tty istiyor — ham mod,
// alternatif ekran, fare bildirimi, pencere boyutu sinyali. child_process
// borusuyla acilsa arayuz bozuk cizilir.
//
// node-pty istege bagli bir bagimlilik: kurulu degilse terminal sekmesi hic
// gorunmuyor, panelin geri kalani (ve bagimlilik istemeyen `node server.js`
// yolu) aynen calismaya devam ediyor.

const path = require('path');
const fs = require('fs');
const os = require('os');

let pty = null;
let loadError = null;
try {
  pty = require('node-pty');
} catch (e) {
  loadError = String((e && e.message) || e).split('\n')[0];
}

const available = () => !!pty;

const terms = new Map();     // id -> { p, cwd, title, dead }
let nextId = 1;

// Login shell: PATH, nvm/asdf, alias'lar ancak boyle yukleniyor. Kullanicinin
// kendi kabugunu kullaniyoruz, sabit bir sey dayatmiyoruz.
//
// Windows'ta /bin/zsh yok: SHELL degiskeni de tanimli olmuyor, o yuzden
// bu dal hep sabit '/bin/zsh'e dusup node-pty'ye "File not found" hatasi
// attiriyordu. Orada PowerShell'i varsayilan aliyoruz (her Windows'ta hazir).
function loginShell() {
  if (process.platform === 'win32') {
    // powershell.exe her Windows'ta hazir gelir ve PATH'tedir; kullanicinin
    // $PROFILE'ini (alias, PATH eklemeleri) POSIX login shell'in .zshrc'si
    // gibi kendisi yukluyor. Eskiden buraya da /bin/zsh dusuyordu — node-pty
    // onu Windows'ta hic bulamiyor, terminal acma her seferinde patliyordu.
    //
    // COMSPEC'e bakmiyoruz: Windows'ta o degisken her zaman tanimli ve her
    // zaman cmd.exe'yi gosteriyor, yani ona bakmak "varsayilan PowerShell"
    // demenin degil "hep cmd" demenin baska bir yolu olurdu. cmd.exe yine de
    // destekleniyor (asagidaki isPowerShell dallari) — sadece kendiliginden
    // secilmiyor.
    return 'powershell.exe';
  }
  const sh = process.env.SHELL || '/bin/zsh';
  try {
    fs.accessSync(sh, fs.constants.X_OK);
    return sh;
  } catch {
    return '/bin/zsh';
  }
}

function isPowerShell(shell) {
  return /(^|[\\/])(powershell|pwsh)(\.exe)?$/i.test(shell);
}

// Uygulama bir Claude oturumunun icinden baslatilmis olabilir (terminalden
// `npm run app`, ya da uygulamayi bir session'dan acmak). O zaman ana surec
// CLAUDE_CODE_SESSION_ID / CLAUDECODE gibi degiskenleri tasiyor ve gomulu
// terminal onlari devraliyor: yeni claude kendini baska bir oturumun alt
// oturumu saniyor, ~/.claude/sessions/<pid>.json dosyasini yazmiyor. Panel de
// onu yalniz `ps` taramasindan goruyor — durumu "unknown", transcript'i yok,
// ofiste masaya oturmuyor.
//
// Yalniz oturuma ozel olanlari siliyoruz. CLAUDE_CONFIG_DIR ya da
// ANTHROPIC_API_KEY gibi kullanicinin kendi ayarlari duruyor.
const SESSION_ENV = new Set([
  'CLAUDECODE', 'CLAUDE_PID', 'CLAUDE_EFFORT',
  'ELECTRON_RUN_AS_NODE', 'MINECLAUDE_SUPERVISED',
]);

function childEnv() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    // Nesneye `undefined` yazmak silmiyor: node-pty onu "undefined" metnine
    // cevirip cocuga oyle veriyor. Gercekten silmek gerekiyor.
    if (SESSION_ENV.has(k) || /^CLAUDE_CODE_/.test(k)) delete env[k];
  }
  env.TERM = 'xterm-256color';
  env.COLORTERM = 'truecolor';
  // `mineclaude` komutu gomulu terminalde hep hazir olsun (bkz. taskBinDir)
  const pk = Object.keys(env).find((k) => /^path$/i.test(k)) || 'PATH';
  try { env[pk] = taskBinDir() + path.delimiter + (env[pk] || ''); } catch { /* yazilamadi: komut yalniz eksik kalir */ }
  return env;
}

// --- gorevler: Claude'a "sunu gorevlere ekle" demek yetsin ---
// Gorev CLI'i server.js'te (--task-add/--task-done/...; <proje>/.mineclaude/tasks.json,
// panel ~1 sn'de goruyor). Iki eksigi burada kapatiyoruz:
//   1) `mineclaude` komutu PATH'te olmayabilir (npm link yapilmamis, paketli uygulama).
//      Gomulu terminalin PATH'ine kucuk bir sarmalayici koyuyoruz: uygulamanin kendi
//      calistirilabilirini ELECTRON_RUN_AS_NODE ile server.js'e yonlendiriyor. Paketli
//      uygulamada server.js asar icinde; Electron-as-node onu okuyabiliyor, duz node okuyamaz.
//      Windows'ta iki kopya: Git Bash (Claude'un Bash araci) icin sh, PowerShell/cmd icin .cmd.
//   2) Claude bu komutu kendiliginden bilmiyor: talimati --settings dosyasindaki bir
//      SessionStart kancasi veriyor (bkz. claude-context.js, claudeSettingsFile).
let binDir = null;
function taskBinDir() {
  if (binDir) return binDir;
  const dir = path.join(os.tmpdir(), 'mineclaude-bin');
  fs.mkdirSync(dir, { recursive: true });
  const exe = process.execPath;
  const server = path.join(__dirname, 'server.js');
  const fwd = (p) => p.replace(/\\/g, '/');
  fs.writeFileSync(path.join(dir, 'mineclaude'),
    `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "${fwd(exe)}" "${fwd(server)}" "$@"\n`, { mode: 0o755 });
  if (process.platform === 'win32') {
    // chcp 65001: "gorev" gibi Turkce metin cmd'den gecerken bozulmasin
    fs.writeFileSync(path.join(dir, 'mineclaude.cmd'),
      `@echo off\r\nsetlocal\r\nchcp 65001 >nul\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${exe}" "${server}" %*\r\n`);
  }
  binDir = dir;
  return dir;
}

// Claude'a verdigimiz tek ayar dosyasi (--settings, yalniz bu oturum; kullanicinin
// global ayarina dokunmuyor, kendi kancalariyla birlesiyor):
//   - SessionStart kancasi: `mineclaude --claude-context` talimati basiyor. Yeni
//     oturumda, --resume'da, /clear'da ve sikistirmada calisiyor (bkz. claude-context.js).
//     Komut PATH'teki sarmalayici (taskBinDir): Git Bash, PowerShell, cmd — hepsinde ayni.
//   - Yalniz `mineclaude` komutuna onceden izin: "gorev ekle" her seferinde sormasin.
//   - Acik temada theme: light — Claude Code renklerini 24-bit basiyor, koyu tema
//     renkleri krem zeminde okunmuyor.
// JSON'u komut satirina gommuyoruz: PowerShell native komutlara ic ice cift tirnagi
// bozuyor (PowerShell/PowerShell#1995, "Invalid JSON provided to --settings").
// Dosya yolu vermek her kabukta guvenilir.
const settingsPaths = {};
function claudeSettingsFile(light) {
  const key = light ? 'light' : 'dark';
  if (!settingsPaths[key]) {
    const cfg = {
      hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'mineclaude --claude-context' }] }] },
      permissions: { allow: ['Bash(mineclaude:*)', 'PowerShell(mineclaude:*)'] },
    };
    if (light) cfg.theme = 'light';
    const file = path.join(os.tmpdir(), `mineclaude-claude-settings-${key}.json`);
    fs.writeFileSync(file, JSON.stringify(cfg));
    settingsPaths[key] = file;
  }
  return settingsPaths[key];
}

function create({ cwd, cols, rows, command, resumeSessionId, light } = {}) {
  if (!pty) throw new Error('node-pty yok: ' + (loadError || 'kurulu degil'));
  const dir = cwd && fs.existsSync(cwd) ? cwd : os.homedir();
  const shell = loginShell();
  const isWin = process.platform === 'win32';
  const ps = isWin && isPowerShell(shell);

  // Oturum kimligi kabuk komutuna giriyor: kalibina uymayani hic gecirmiyoruz.
  // (Ag uzerinden terminal acikken -- --terminals -- bu payload disaridan geliyor.)
  const resume = /^[A-Za-z0-9-]{6,80}$/.test(String(resumeSessionId || '')) ? resumeSessionId : null;

  const q = isWin && !ps ? '"' : "'";
  let ayarArg = '';
  try { ayarArg = ` --settings ${q}${claudeSettingsFile(!!light)}${q}`; } catch { /* yazilamadi: ayarsiz ac */ }
  const claude = (extra = '') => `claude${extra}${ayarArg}`;

  // Oturum kimligi verilmisse ona don, bulunamazsa (silinmis, hic konusulmamis)
  // taze bir claude ac. POSIX ve cmd.exe'de `||` bunu tek satirda hallediyor;
  // Windows'ta hazir gelen powershell.exe (5.1) `||`/`&&` bilmiyor (PowerShell
  // 7'de var), o yuzden orada cikis koduna bakan bir if ile ayni seyi kuruyoruz.
  const cmd = resume
    ? (ps
        ? `${claude(' --resume ' + resume)}; if ($LASTEXITCODE -ne 0) { ${claude()} }`
        : `${claude(' --resume ' + resume)} || ${claude()}`)
    : (command || claude());

  // Varsayilan: claude'u calistir, o kapaninca kabuk acik kalsin. Session bitince
  // pencerenin kapanmasi yerine elinde bir kabuk kaliyor (resume, git, ne gerekirse).
  // '-i' sart: zsh `-l -c` ile .zshrc'yi OKUMUYOR, yalniz .zprofile'i okuyor.
  // Kullanicilarin PATH eklemeleri (~/.local/bin, nvm, pyenv) genelde .zshrc'de
  // oturuyor; onsuz uygulama Finder'dan acildiginda `claude` bulunamiyor.
  // Windows'ta kabugu acik tutan bayrak PowerShell'de -NoExit, cmd.exe'de /k.
  const args = isWin
    ? (ps ? ['-NoLogo', '-NoExit', '-Command', cmd] : ['/k', cmd])
    : ['-l', '-i', '-c', `${cmd}; exec ${shell} -l`];

  const p = pty.spawn(shell, args, {
    name: 'xterm-256color',
    cwd: dir,
    cols: cols || 80,
    rows: rows || 24,
    env: childEnv(),
  });

  const id = String(nextId++);
  // ptsName cocugun gordugu tty ile birebir ayni (/dev/ttysNNN). Panel de session'in
  // tty'sini biliyor; ikisini eslestirince bir session'in bu uygulamanin icinde mi
  // yoksa disarida bir terminalde mi kostugu kesin olarak anlasiliyor.
  const tty = String(p.ptsName || '').replace('/dev/', '') || null;
  const title = path.basename(dir) || dir;
  terms.set(id, { p, cwd: dir, title, tty, dead: false });
  return { id, cwd: dir, title, tty };
}

function attach(id, onData, onExit) {
  const t = terms.get(id);
  if (!t) return;
  // Yeniden baglanmada attach tekrar cagriliyor. node-pty dinleyicileri
  // biriktirdigi icin cikti her seferinde bir fazla kopyalanirdi; guncel
  // alicilari tek yerde tutup dinleyiciyi bir kez baglıyoruz.
  t.onData = onData;
  t.onExit = onExit;
  if (t.wired) return;
  t.wired = true;
  t.p.onData((d) => { if (t.onData) t.onData(id, d); });
  t.p.onExit(({ exitCode, signal }) => {
    t.dead = true;
    if (t.onExit) t.onExit(id, exitCode, signal);
  });
}

function write(id, data) {
  const t = terms.get(id);
  if (t && !t.dead) t.p.write(data);
}

function resize(id, cols, rows) {
  const t = terms.get(id);
  if (!t || t.dead) return;
  try {
    t.p.resize(Math.max(2, cols | 0), Math.max(1, rows | 0));
  } catch { /* surec kapanmis olabilir */ }
}

function kill(id) {
  const t = terms.get(id);
  if (!t) return;
  try { t.p.kill(); } catch { /* zaten olmus */ }
  terms.delete(id);
}

function killAll() {
  for (const id of [...terms.keys()]) kill(id);
}

const list = () => [...terms.entries()].map(([id, t]) => ({ id, cwd: t.cwd, title: t.title, tty: t.tty, dead: t.dead }));

module.exports = { available, loadError: () => loadError, create, attach, write, resize, kill, killAll, list };
