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
function loginShell() {
  const sh = process.env.SHELL || '/bin/zsh';
  try {
    fs.accessSync(sh, fs.constants.X_OK);
    return sh;
  } catch {
    return '/bin/zsh';
  }
}

function create({ cwd, cols, rows, command } = {}) {
  if (!pty) throw new Error('node-pty yok: ' + (loadError || 'kurulu degil'));
  const dir = cwd && fs.existsSync(cwd) ? cwd : os.homedir();
  const shell = loginShell();

  // Varsayilan: claude'u calistir, o kapaninca kabuk acik kalsin. Session bitince
  // pencerenin kapanmasi yerine elinde bir kabuk kaliyor (resume, git, ne gerekirse).
  const cmd = command || 'claude';
  const args = ['-l', '-c', `${cmd}; exec ${shell} -l`];

  const p = pty.spawn(shell, args, {
    name: 'xterm-256color',
    cwd: dir,
    cols: cols || 80,
    rows: rows || 24,
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      // Electron kendi degiskenlerini cocuga birakmasin
      ELECTRON_RUN_AS_NODE: undefined,
      MINECLAUDE_SUPERVISED: undefined,
    },
  });

  const id = String(nextId++);
  terms.set(id, { p, cwd: dir, title: path.basename(dir) || dir, dead: false });
  return { id, cwd: dir, title: path.basename(dir) || dir };
}

function attach(id, onData, onExit) {
  const t = terms.get(id);
  if (!t) return;
  t.p.onData((d) => onData(id, d));
  t.p.onExit(({ exitCode, signal }) => {
    t.dead = true;
    onExit(id, exitCode, signal);
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

const list = () => [...terms.entries()].map(([id, t]) => ({ id, cwd: t.cwd, title: t.title, dead: t.dead }));

module.exports = { available, loadError: () => loadError, create, attach, write, resize, kill, killAll, list };
