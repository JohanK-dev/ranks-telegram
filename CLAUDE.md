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

- **`server.js`** — Wires `IrcManager` and `TelegramManager` together via callbacks/events. `onAnswer(text, question)` returns `{sent, reason}`; if not sent, the question stays active and the user is told why.
- **`answer.js`** — Pure helper `normalizeAnswer` (multiplication shortcut, e.g. "5 3" → "15").
- **`irc-manager.js`** — Game-level IRC logic on top of `IrcClient`. Emits events: `connected`, `joined`, `scoring-alert`, `question`, `question-error`, `scoring-over`. Exposes `currentNick` (shown in `/status`).
- **`irc-client.js`** — Our own minimal IRC client (no third-party IRC library): TCP connect, `NICK`/`USER` registration, `PING`/`PONG` (incl. QuakeNet's pre-registration PING cookie), channel join/rejoin on kick, idle keepalive/dead-connection detection, reconnect with backoff, and nick handling. Never strips color codes — `parseQuestion` needs them. Takes an injectable `createConnection`/`now` for tests.
- **`irc-protocol.js`** — Pure helpers: line parsing, RFC1459 nick case mapping (`sameNick`), fallback nick generation, and `buildLine`, which strips CR/LF/NUL from every param so Telegram text can never inject extra IRC commands.
- **`telegram-manager.js`** — Telegram polling bot. Tracks `activeQuestion` (one at a time, cleared after answer) and `pausedUsers` (Set). Auth is via `allowedUserIds` in config — empty array means no restriction.
- **`parseQuestion.js`** — Pure function. Parses IRC color codes (`\x03CC`) to find math equations, validates exactly one red (`\x0304`) equation exists, returns `{success, question}`.
- **`config.example.js`** — Configuration template checked into the repo. Copy to `config.js` (gitignored) and fill in `botToken` and `allowedUserIds` before running — `server.js` requires `./config`, not the example file.

### Game rules — never validate answers

The bot must **never** compute, check, or correct the answer to an equation. Evaluating the red equation to block, fix, or suggest answers is against the rules of the #Ranks game. The user must always be able to send a wrong answer; whatever they type (after the explicit "5 3" → "15" shortcut) goes to IRC as-is. Safeguards may only use information unrelated to the math: timing, connection state, message metadata, and so on.

### Parsing detail

IRC messages use `\x03` as color delimiter followed by a 2-digit color code. `parseQuestion` splits on `\x03`, extracts equations matching `/(\d+[+\-*\/]\d+)/`, and identifies red equations by the `04` color code prefix. Returns an error if there are 0 or 2+ red equations.

### Nickname handling (irc-client.js)

The bot tries to hold the configured `nickname`. If it's taken while registering (`432`/`433`/`437` before `001`), `IrcClient` tries `nickname + nickSuffix` (default `{`), then `{{`, and so on, shortened to fit `NICKLEN` (15 on QuakeNet; the server would otherwise silently truncate it back into the taken nick). It never uses a numeric `<nick>1` style fallback.

Once registered on a fallback, it reclaims the nick in two ways, and only sends `NICK` when the nick is known to be free:
- the holder's `QUIT` or `NICK` away (seen only if we share a channel with them);
- an `ISON <nick>` check every 30s from `_tick()`, sending `NICK` only if the `303` reply doesn't list the nick. This covers the common case: after a disconnect, the ghost of our old connection times out before we've rejoined #ranks, so we never see its QUIT.

A `433` *after* registration (a reclaim lost a race) is just logged; the server keeps our current nick, so nothing gets renamed. `_tryReclaim` rate-limits attempts to one per 10s.

### Telegram commands and per-user pause state

`TelegramManager` handles `/start` (reveals the user's Telegram ID for `allowedUserIds`), `/status` (delegates to `server.js`'s `onStatusRequest` callback), `/pause`, and `/resume`. Paused user IDs live in the in-memory `pausedUsers` Set and are excluded from question/error broadcasts (`_getActiveChatIds()`) but can still submit an answer to an active question even while paused. Answers whose Telegram `msg.date` is more than 5s before the question's timestamp are ignored as stale. Note this does not catch a message the phone client queued while offline and delivered late: Telegram stamps `msg.date` when the server receives it, so such a message looks fresh. Every forwarded answer gets a `✅ Sent: <answer>` reply, so the user notices when an answer never reached the bot. All state (`activeQuestion`, `pausedUsers`) is in-memory only and resets on restart.
