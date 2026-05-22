# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start          # Run the bot
npm run dev        # Run with hot-reload (node --watch)
npm test           # Run all tests
node --test tests/parseQuestion.test.js  # Run a single test file
```

Requires Node.js 18+ (uses `node --test` and `node --watch`).

## Architecture

This bot bridges the IRC game `#Ranks` on QuakeNet to Telegram. A bot called `MACHINE[]` posts math equations in IRC; the correct (red-highlighted) equation must be answered first to score points.

**Data flow:** `MACHINE[]` IRC message → `IrcManager` parses → `server.js` routes → `TelegramManager` sends to Telegram users → user replies → `server.js` sends answer back to IRC via `IrcManager`.

### Module responsibilities

- **`server.js`** — Wires `IrcManager` and `TelegramManager` together via callbacks/events. Handles the multiplication shortcut (e.g. "5 3" → sends "15").
- **`irc-manager.js`** — Persistent IRC connection to `irc.quakenet.org`. Emits events: `connected`, `scoring-alert`, `question`, `question-error`, `scoring-over`. Uses `stripColors: false` to preserve IRC color codes needed for parsing.
- **`telegram-manager.js`** — Telegram polling bot. Tracks `activeQuestion` (one at a time, cleared after answer) and `pausedUsers` (Set). Auth is via `allowedUserIds` in config — empty array means no restriction.
- **`parseQuestion.js`** — Pure function. Parses IRC color codes (`\x03CC`) to find math equations, validates exactly one red (`\x0304`) equation exists, returns `{success, question}`.
- **`config.js`** — Configuration template (not a real config). Fill in `botToken` and `allowedUserIds` before running.

### Parsing detail

IRC messages use `\x03` as color delimiter followed by a 2-digit color code. `parseQuestion` splits on `\x03`, extracts equations matching `/(\d+[+\-*\/]\d+)/`, and identifies red equations by the `04` color code prefix. Returns an error if there are 0 or 2+ red equations.
