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
- **`config.example.js`** — Configuration template checked into the repo. Copy to `config.js` (gitignored) and fill in `botToken` and `allowedUserIds` before running — `server.js` requires `./config`, not the example file.

### Parsing detail

IRC messages use `\x03` as color delimiter followed by a 2-digit color code. `parseQuestion` splits on `\x03`, extracts equations matching `/(\d+[+\-*\/]\d+)/`, and identifies red equations by the `04` color code prefix. Returns an error if there are 0 or 2+ red equations.

### Nickname reclaim (irc-manager.js)

The bot tries to hold a specific configured nickname on QuakeNet. If it's taken at connect time, the `irc` library falls back to an alternate nick on its own (raw `433`) — `IrcManager` does *not* retry immediately on `registered`, since the nick is known-taken at that point and an immediate retry would just collide again. Instead it reclaims the desired nick purely reactively, by watching `nick` and `quit` events for whoever is holding it and sending `NICK` the moment it frees up. This logic is split across the `registered`, `nick`, `quit`, and `raw` listeners in `connect()` — read all of them together to understand the reclaim flow.

Important library quirk: the `irc` package has its own internal `err_nicknameinuse` (433) handler (`node_modules/irc/lib/irc.js`) that fires independently of the `raw` listener here — on every 433 it increments an internal `nickMod` counter and actually sends `NICK <configured><nickMod>`, i.e. it renames the client. So any `NICK` attempt this module sends that collides (e.g. a reactive reclaim racing another client for the same nick) will itself trigger a real, visible nick change via the library's fallback — not a silent failure. Avoid sending speculative `NICK` requests for a nick you don't already know is free.

### Telegram commands and per-user pause state

`TelegramManager` handles `/start` (reveals the user's Telegram ID for `allowedUserIds`), `/status` (delegates to `server.js`'s `onStatusRequest` callback), `/pause`, and `/resume`. Paused user IDs live in the in-memory `pausedUsers` Set and are excluded from question/error broadcasts (`_getActiveChatIds()`) but can still submit an answer to an active question even while paused. All state (`activeQuestion`, `pausedUsers`) is in-memory only and resets on restart.
