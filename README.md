# Ranks Scoring — Telegram Bot

IRC #Ranks scoring game Telegram bot — get instant Telegram notifications with scoring questions and answer directly in the chat.

## Architecture

```
Telegram App  ◄──Telegram API──►  Server (Node.js)  ◄──IRC──►  QuakeNet #Ranks
```

The server maintains a persistent IRC connection to QuakeNet and joins #Ranks. When MACHINE[] starts a scoring round, the server parses the question, identifies the red equation, and sends it to your Telegram chat. You type the answer directly in the chat and the server relays it back to IRC as a PRIVMSG to MACHINE[].

## Requirements

- A server that can stay online (home PC, VPS, Raspberry Pi, etc.)
- Node.js 18+
- A Telegram account
- Internet access from the server (outbound to IRC and Telegram API)
- A questionable sense of how to spend your free time

## Setup

### 1. Install Node.js

**Debian/Ubuntu:**
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install -y nodejs
```

**Other platforms:** https://nodejs.org/en/download

### 2. Create a Telegram bot

1. Open Telegram and search for **@BotFather**
2. Send `/newbot`
3. Choose a display name (e.g. "Ranks Scoring")
4. Choose a username
5. BotFather gives you a **bot token**, copy it

### 3. Deploy the server

Copy the project folder to your server and navigate to it:

```bash
cd ranks-scoring-telegram
npm install
```

### 4. Configure

Edit `config.js`:

```js
module.exports = {
  irc: {
    server: "irc.quakenet.org",
    port: 6667,
    nickname: "YourNick",       // Your IRC nickname
    channel: "#Ranks",
    machineNick: "MACHINE[]",
  },
  telegram: {
    botToken: "123456:ABC-DEF...",  // Token from BotFather
    allowedUserIds: [],              // Leave empty for now
  },
};
```

### 5. First run — get your user ID

```bash
npm start
```

Open Telegram and send `/start` to your bot. It will reply with your **user ID** (a number like `123456789`). Copy it and add it to `config.js`:

```js
allowedUserIds: [123456789],
```

Multiple users can be added by adding more IDs to the array. Restart the server after updating.

### 6. Run as a background service (optional)

Create `/etc/systemd/system/ranks-scoring.service`:

```ini
[Unit]
Description=Ranks Scoring Telegram Bot
After=network.target

[Service]
Type=simple
User=YOUR_USERNAME
WorkingDirectory=/path/to/ranks-scoring-telegram
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable ranks-scoring
sudo systemctl start ranks-scoring

# View logs
journalctl -u ranks-scoring -f
```

## Usage

When a scoring round starts in #Ranks, the bot sends the question to your Telegram chat. The red equation is highlighted. Type your answer and send it.

### Commands

| Command   | Description                                |
|-----------|--------------------------------------------|
| `/start`  | Shows your user ID and available commands  |
| `/status` | Shows IRC connection and notification status |
| `/pause`  | Stop receiving questions                   |
| `/resume` | Start receiving questions again            |

### Pause & resume

Use `/pause` to temporarily stop receiving scoring questions (e.g. when you're busy or sleeping). The bot will silently skip sending you questions until you send `/resume`. You can check your current notification status with `/status`.

Note: even while paused, you can still send an answer if you happen to see a question — the bot will accept it.

### Answering

- **Type a number** — type your answer and send it as a regular message
- **Multiplication shortcut**  type `5 3` (space-separated) to send `15`
- Your answer is sent to IRC exactly as typed, no trimming of whitespace etc

## How it works

1. MACHINE[] announces `IT IS SCORING TIME` in #Ranks
2. MACHINE[] sends a private message with color-coded math equations
3. The server parses IRC color codes to identify which equation is red (color code `04`)
4. If parsing succeeds: question is sent to Telegram with the red equation highlighted
5. If parsing fails: error message is shown, no answer is sent.
6. You type the answer in the Telegram chat
7. The server sends your answer as a PRIVMSG to MACHINE[]
8. MACHINE[] sends "Scoring over" — the bot clears the active question silently

## Misc info

- **allowedUserIds** restricts who can interact with the bot. Only listed Telegram user IDs can receive questions and send answers.
- The IRC connection is outbound-only, no incoming ports need to be open on your server.
- The Telegram Bot API uses HTTPS, all communication is encrypted.
- No data is stored on disk, the server is stateless (pause state resets on restart).

## Network requirements

The server needs outbound access to:
- `irc.quakenet.org:6667` (IRC)
- `api.telegram.org:443` (Telegram Bot API)

No inbound ports, VPN, HTTPS certificates, or special networking required.

## Troubleshooting

**Bot doesn't respond to /start:**
Make sure the bot token is correct and the server is running. Check logs with `journalctl -u ranks-scoring -f`.

**"No active question right now":**
You sent an answer when no scoring round was active. Wait for MACHINE[] to start a round.

**Question parse failed:**
The parser couldn't identify the red equation from the IRC color codes. The raw message is logged on the server in both hex and escaped format for debugging. If MACHINE[] changes its message format, adjust `_parseQuestion()` in `irc-manager.js`.

**Can't connect to QuakeNet:**
QuakeNet may prefix your username with `~` if no ident server is running, this is normal and doesn't prevent connecting. If your nickname is taken, try a different one.

## File structure

```
ranks-scoring-telegram/
├── server.js              # Main entry — wires IRC events to Telegram
├── irc-manager.js         # IRC connection, question parsing, reconnection
├── telegram-manager.js    # Telegram bot — sends questions, receives answers
├── config.js              # All configuration
└── package.json
```
