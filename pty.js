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
//   2) Claude bu komutu kendiliginden bilmiyor: acarken --append-system-prompt-file ile
//      kisa bir talimat veriyoruz. --settings'teki gibi dosya yolu: tirnaklama derdi yok.
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

// Iki ayri, birbirinden bagimsiz ozellik; talimatta da ayri duruyorlar.
const TASKS_PROMPT = [
  '## mineClaude task list',
  'mineClaude shows a per-project task list (stored in .mineclaude/tasks.json).',
  'When the user asks you to add, note or remember a task / to-do (Turkish: "görev ekle", "görevlere ekle",',
  '"yapılacaklara ekle", "not al", "şunu görev olarak yaz"...), add it with the shell command',
  'mineclaude --task-add "<short task text>" run from the project folder, in the user\'s language,',
  'one command per task, then confirm briefly. It shows up in the mineClaude panel within a second.',
  'Other commands: mineclaude --tasks (list), mineclaude --task-done "<id or part of text>",',
  'mineclaude --task-undone "<...>", mineclaude --task-rm "<...>". Mark a task done only when',
  'the user says it is done or asks you to. Do not edit tasks.json by hand.',
].join('\n');

const BROWSER_PROMPT = [
  '## mineClaude browser',
  'mineClaude has its own built-in browser tabs, next to this terminal. When the user asks you to open',
  'or show something in a browser (Turkish: "tarayıcıda aç", "projeyi aç", "siteyi aç", "önizlemeyi göster",',
  '"localhost\'u aç"...), open it there with the shell command mineclaude --open "<url>" — never an external',
  'browser (no start/open/xdg-open/explorer, no Playwright for this). mineclaude --open with no URL opens this',
  'project itself: its running dev server if one is up, otherwise its live site. Relative forms work too:',
  'mineclaude --open 8100, mineclaude --open localhost:5173/admin. If you start a dev server, pass its',
  '"don\'t open a browser" flag (ionic serve --no-open, ng serve without --open, vite without --open) —',
  'mineClaude notices the server and opens it itself.',
].join('\n');

const TASK_PROMPT = ['You are running inside mineClaude.', TASKS_PROMPT, BROWSER_PROMPT].join('\n\n');

let taskPromptPath = null;
function taskPromptFile() {
  if (!taskPromptPath) {
    taskPromptPath = path.join(os.tmpdir(), 'mineclaude-task-prompt.txt');
    fs.writeFileSync(taskPromptPath, TASK_PROMPT);
  }
  return taskPromptPath;
}

// Acik tema oturumu icin --settings'e verilecek JSON'u bir kere yazip yolunu
// onbellekliyoruz: her terminal acilisinda yeniden yazmaya gerek yok, icerik
// hic degismiyor.
let lightSettingsPath = null;
function lightThemeSettingsFile() {
  if (!lightSettingsPath) {
    lightSettingsPath = path.join(os.tmpdir(), 'mineclaude-light-theme-settings.json');
    fs.writeFileSync(lightSettingsPath, '{"theme":"light"}');
  }
  return lightSettingsPath;
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

  // Claude Code temasini ~/.claude/settings.json'dan okuyor ve renklerini 24-bit
  // basiyor, yani xterm paletiyle ezilemiyorlar: uygulama acik temadayken onun
  // koyu tema renkleri krem zeminde okunmuyor. --settings yalniz bu oturumu
  // baglıyor, kullanicinin global ayarina dokunmuyoruz.
  //
  // JSON'u dogrudan komut satirina gomup kabuga gore tirnaklamaya guvenmiyoruz:
  // PowerShell native komutlara arguman aktarirken ic ice cift tirnaklari
  // bozuyor (bkz. PowerShell/PowerShell#1995) ve "Invalid JSON provided to
  // --settings" hatasi veriyordu. Bunun yerine JSON'u bir dosyaya yazip
  // --settings <dosya yolu> veriyoruz: tek kacis sorunu path'i kabuga gore
  // tirnaklamak, ki bu her kabukta guvenilir calisiyor.
  const q = isWin && !ps ? '"' : "'";
  const temaArg = !light ? '' : ` --settings ${q}${lightThemeSettingsFile()}${q}`;
  let gorevArg = '';
  // Yalniz `mineclaude` komutuna onceden izin: "gorev ekle" her seferinde izin sormasin.
  // --allowedTools degisken sayida arguman aliyor; en sonda duruyor ki baska bir seyi yutmasin.
  try {
    gorevArg = ` --append-system-prompt-file ${q}${taskPromptFile()}${q}`
      + ` --allowedTools ${q}Bash(mineclaude:*)${q} ${q}PowerShell(mineclaude:*)${q}`;
  } catch { /* yazilamadi: talimatsiz ac */ }
  const claude = (extra = '') => `claude${extra}${temaArg}${gorevArg}`;

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
