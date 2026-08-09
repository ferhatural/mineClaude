# ccwatch

> 🇹🇷 [Türkçe README](README.tr.md)

A local dashboard for every Claude Code CLI session running on your machine: how many there are,
which folder each one is in, which is working, which has gone quiet — and **which one is waiting
for you to type something**.

No dependencies, no network access, no telemetry. Just Node and the files Claude Code already
writes on your disk.

![Card view](docs/cards.png)

Or, if you would rather see your sessions as an office:

![Office view](docs/office.png)

People at desks are working, the one with a raised hand needs your input, and the ones on the
sofa have been idle for a while. Status changes make them walk — through the door, not the wall.

---

## Install

```bash
git clone https://github.com/ferhatural/ccwatch.git
cd ccwatch
node server.js
```

Opens `http://localhost:7788`. Node 18+ is enough. There is nothing to install.

```bash
node server.js            # web dashboard (default)
node server.js --watch    # live table in the terminal, refreshes every 2s
node server.js --once     # print the table once and exit
node server.js --json     # raw JSON, for scripting
node server.js --port 7799 --no-open
```

To call it from anywhere:

```bash
ln -s "$PWD/server.js" /usr/local/bin/ccwatch
```

## Statuses

| Status | Meaning |
|---|---|
| **waiting for input** (amber) | Claude asked you something or needs a permission decision — the keyboard is yours |
| **working** (green) | Thinking or running a tool; the card shows which tool and its argument |
| **standing by** (blue) | Claude answered and it is your turn — there was activity in the last 15 minutes |
| **idle** (grey) | Quiet for more than 15 minutes |
| **unknown** | Process is alive but publishes no status (older versions, or a child process) |
| **ended** | Process is gone but the transcript is there — resume it with `claude --resume <id>` |

Claude Code writes `idle` the instant a turn ends, so a five-second-old session and a
three-day-old one look identical in the raw data. That is why `idle` is split in two here.
The threshold is `COLD_MS` in `server.js`.

## Where the data comes from

| Source | What it gives |
|---|---|
| `~/.claude/sessions/<pid>.json` | Live status (`busy` / `waiting` / `idle`), `waitingFor`, cwd, session id, version |
| `ps -axo …` | Whether the process is actually alive, its tty, CPU/RAM, and which app it runs under |
| `~/.claude/projects/**/<sessionId>.jsonl` | Claude's last message, your last prompt, the running tool, model, context size, git branch |

Status comes from the session file first — that is Claude Code's own bookkeeping and the most
reliable source. When a session file has no `status` field (older versions do not write one),
the status is inferred from the tail of the transcript and the card says so.

Stale `sessions/*.json` files belonging to dead PIDs are ignored; only processes that are really
running count as live.

Two details worth knowing if you plan to hack on this:

- **The transcript file's mtime is not a reliable activity signal.** It gets touched without a new
  message arriving. The real measure is the timestamp of the last event *inside* the file.
- The card's main line is **Claude's last message** (markdown stripped). Your own prompt and the
  conversation's topic title are in the tooltip — you already know what you typed; what you want
  to see at a glance is the answer.

## Sending messages to a session

If a session has a messaging socket, its card gets a text box that writes a line of JSON to
`/tmp/cc-socks/<pid>.sock`. Claude Code listens there:

```bash
echo '{"type":"user","message":{"role":"user","content":"hello"}}' \
  | socat - UNIX-CONNECT:/tmp/cc-socks/12345.sock
```

Two things to expect:

1. **The message arrives framed as coming from another Claude session**, not as something you
   typed. It cannot approve a pending permission prompt — the protocol explicitly refuses that.
2. **The socket only exists if the session was started with it.** It is created once at startup
   behind a feature flag, and you cannot attach one to a running process afterwards. Cards without
   a socket show the box greyed out with the reason in the tooltip.

To guarantee the socket for every new session:

```bash
echo 'export CLAUDE_CODE_HARBOR_KITE=1' >> ~/.zshrc
```

Then open a new terminal. Existing sessions have to be restarted (`claude --resume <id>` keeps
the conversation) before they get one.

## Dashboard

- Live updates over SSE every 2 seconds; the browser tab title shows how many sessions want you
- Optional desktop notification the moment a session starts waiting for input
- Click a status tile to filter
- Column count is selectable (auto, 1–6) and remembered; single column on narrow screens;
  fullscreen button in the corner
- Icon buttons on every card copy `claude --resume <id>`, `cd <folder>`, or the transcript path
- Sessions an editor started but never used are hidden by default

## Office view

The 👥 button in the top right toggles between cards and a 2D office (the choice is remembered).
Everything is drawn as inline SVG in Minecraft-ish pixel style — characters are built from sprite
maps at Steve proportions (8×8 head, 4×12 arms), the scene from block patterns.

- **working** — behind their own desk, head down
- **waiting for input** — standing beside the desk, facing you, hand up, `?` above their head
- **standing by** — still at the desk, not yet cold
- **idle** — in the lounge: on the sofa, holding coffee, or gossiping in pairs

When a session's status changes the character walks to its new spot: legs and arms swing in a
two-frame step, the duration scales with distance, and crossing between the office and the lounge
routes through the doorway. Slots are sticky, so one person leaving does not shuffle everyone else.
All animation stops under `prefers-reduced-motion`.

> Implementation note: SVG has no `z-index`, so depth ordering means reordering DOM nodes — and
> moving a node cancels a running CSS transition. That is why the reorder happens only when the
> order actually changed, and always *before* any movement starts.

## Notes and limits

- Read-only by design apart from the message box. It never kills or restarts a session.
- Binds to `127.0.0.1` only. `POST /api/send` additionally rejects foreign `Origin` headers.
- Written for macOS: it parses BSD `ps` and `lsof` output. Linux should mostly work but the `ps`
  line parsing deserves a review first.
- It leans on Claude Code internals (`~/.claude/sessions`, the transcript format, the messaging
  socket) that are undocumented and may change between versions. If a release breaks something
  here, that is why.
- The UI strings are in Turkish. They are inline in `index.html` and `office.js` if you want to
  change them.

## License

MIT
