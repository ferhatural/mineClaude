'use strict';
// mineClaude terminalinde calisan Claude'a verilen talimat. Iki ayri, birbirinden
// bagimsiz ozellik; metinde de ayri bolumler.
//
// Nasil ulasiyor: pty.js Claude'u --settings ile aciyor, o ayar dosyasindaki
// SessionStart kancasi `mineclaude --claude-context` calistiriyor ve bu metni
// basiyor (server.js). Kanca yeni oturumda, --resume'da, /clear'da ve sikistirmada
// her seferinde calisiyor. --append-system-prompt[-file] bunun yerine
// kullanilamiyor: Claude Code onu --resume ile acilan oturumda yok sayiyor
// (denendi) — "geri yukle" ile gelen her sekme talimatsiz kaliyordu.

const TASKS = [
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

const BROWSER = [
  '## mineClaude browser',
  'mineClaude has its own built-in browser tabs, next to this terminal. When the user asks you to open',
  'or show something in a browser (Turkish: "tarayıcıda aç", "projeyi aç", "siteyi aç", "önizlemeyi göster",',
  '"localhost\'u aç"...), open it there with the shell command mineclaude --open "<url>". Never open an',
  'external browser for this: no Start-Process, start, explorer, open, xdg-open, and no Playwright.',
  'mineclaude --open with no URL opens this project itself: its running dev server if one is up, otherwise',
  'its live site — so when you are not sure which address the user means, run it with no URL first instead',
  'of searching for one. Relative forms work too: mineclaude --open 8100, mineclaude --open localhost:5173/admin.',
  'If you start a dev server, pass its "don\'t open a browser" flag (ionic serve --no-open, ng serve without',
  '--open, vite without --open) — mineClaude notices the server and opens it itself.',
].join('\n');

const CLAUDE_CONTEXT = ['You are running inside mineClaude.', TASKS, BROWSER].join('\n\n');

module.exports = { CLAUDE_CONTEXT };
