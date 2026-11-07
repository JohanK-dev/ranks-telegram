// Minimal IRC client — just what the #Ranks bridge needs on QuakeNet:
// register (incl. answering QuakeNet's pre-registration PING cookie), join a
// channel, send/receive PRIVMSG, keepalive, reconnect, and nickname handling
// that we fully control (no forced "<nick>1" fallback renames).

const net = require("net");
const EventEmitter = require("events");
const {
  DEFAULT_NICKLEN,
  parseLine,
  sameNick,
  fallbackNick,
  stripLineBreaks,
  buildLine,
} = require("./irc-protocol");

const MAX_LINE_BYTES = 510; // RFC limit excluding CRLF
const MAX_BUFFER = 64 * 1024; // drop the connection if the server sends this much without a newline
const TICK_MS = 15 * 1000;
const PING_AFTER_IDLE_MS = 90 * 1000;
const DEAD_AFTER_IDLE_MS = 180 * 1000;
const RECLAIM_CHECK_MS = 30 * 1000;
const RECLAIM_MIN_GAP_MS = 10 * 1000;
const REJOIN_DELAY_MS = 5 * 1000;
const RECONNECT_MIN_MS = 5 * 1000;
const RECONNECT_MAX_MS = 120 * 1000;

class IrcClient extends EventEmitter {
  /**
   * options: { server, port, nickname, userName, realName, channel, nickSuffix }
   * deps.createConnection: injectable for tests (defaults to net.connect)
   */
  constructor(options, deps = {}) {
    super();
    this.opt = {
      nickSuffix: "{",
      userName: options.nickname,
      realName: "Ranks Scoring Bot",
      ...options,
    };
    this.createConnection = deps.createConnection || ((port, host) => net.connect(port, host));
    this.now = deps.now || (() => Date.now());

    this.socket = null;
    this.buffer = "";
    this.nick = null; // nick the server currently knows us by
    this.registered = false;
    this.stopped = false;
    this.nickLen = DEFAULT_NICKLEN;
    this.fallbackAttempt = 0;
    this.reconnectDelay = RECONNECT_MIN_MS;
    this.reconnectTimer = null;
    this.tickTimer = null;
    this.lastRx = 0;
    this.pingSent = false;
    this.lastReclaimCheck = 0;
    this.lastReclaimAttempt = 0;
  }

  get desiredNick() {
    return this.opt.nickname;
  }

  hasDesiredNick() {
    return sameNick(this.nick, this.desiredNick);
  }

  // ─── Connection lifecycle ──────────────────────────────────────────

  connect() {
    this.stopped = false;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;

    this.buffer = "";
    this.registered = false;
    this.fallbackAttempt = 0;
    this.pingSent = false;
    this.lastRx = this.now();

    const socket = this.createConnection(this.opt.port, this.opt.server);
    this.socket = socket;
    socket.setEncoding("utf8");
    if (socket.setKeepAlive) socket.setKeepAlive(true, 60 * 1000);

    socket.on("connect", () => {
      if (socket !== this.socket) return;
      this.emit("log", `TCP connected to ${this.opt.server}:${this.opt.port}, registering`);
      this.nick = this.desiredNick;
      this._send("NICK", this.nick);
      this._send("USER", this.opt.userName, "0", "*", this.opt.realName);
    });

    socket.on("data", (chunk) => {
      if (socket !== this.socket) return;
      this._onData(chunk);
    });

    socket.on("error", (err) => {
      if (socket !== this.socket) return;
      this.emit("netError", err);
    });

    socket.on("close", () => {
      if (socket !== this.socket) return;
      this._onClose();
    });

    clearInterval(this.tickTimer);
    this.tickTimer = setInterval(() => this._tick(), TICK_MS);
  }

  /** Graceful disconnect; no automatic reconnect afterwards. */
  quit(message = "Leaving") {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.socket) {
      try {
        this._send("QUIT", message);
      } catch (_) {
        /* socket may already be gone */
      }
      const s = this.socket;
      setTimeout(() => s.destroy(), 1000).unref();
      s.end();
    }
  }

  _onClose() {
    const wasRegistered = this.registered;
    this.registered = false;
    this.socket = null;
    clearInterval(this.tickTimer);
    this.tickTimer = null;
    this.emit("disconnected", wasRegistered);

    if (this.stopped) return;
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
    this.emit("log", `Connection closed, reconnecting in ${Math.round(delay / 1000)}s`);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  _drop(reason) {
    this.emit("log", `Dropping connection: ${reason}`);
    if (this.socket) this.socket.destroy();
  }

  // ─── Periodic work: keepalive + nick reclaim check ─────────────────

  _tick() {
    if (!this.socket) return;
    const idle = this.now() - this.lastRx;

    if (idle > DEAD_AFTER_IDLE_MS) {
      this._drop(`no data from server for ${Math.round(idle / 1000)}s`);
      return;
    }
    if (idle > PING_AFTER_IDLE_MS && !this.pingSent && this.registered) {
      this.pingSent = true;
      this._send("PING", "keepalive");
    }

    if (this.registered && !this.hasDesiredNick() &&
        this.now() - this.lastReclaimCheck >= RECLAIM_CHECK_MS) {
      // Ask whether the desired nick is online. We only send NICK once the
      // server tells us it's free (RPL_ISON), so no speculative collisions.
      this.lastReclaimCheck = this.now();
      this._send("ISON", this.desiredNick);
    }
  }

  _tryReclaim(reason) {
    if (!this.registered || this.hasDesiredNick()) return;
    if (this.now() - this.lastReclaimAttempt < RECLAIM_MIN_GAP_MS) return;
    this.lastReclaimAttempt = this.now();
    this.emit("log", `"${this.desiredNick}" is free (${reason}), reclaiming`);
    this._send("NICK", this.desiredNick);
  }

  // ─── Incoming data ─────────────────────────────────────────────────

  _onData(chunk) {
    this.lastRx = this.now();
    this.pingSent = false;
    this.buffer += chunk;

    if (this.buffer.length > MAX_BUFFER && this.buffer.indexOf("\n") < 0) {
      this._drop("oversized line from server");
      return;
    }

    let idx;
    while ((idx = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, idx).replace(/\r$/, "");
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      const msg = parseLine(line);
      if (!msg) continue;
      try {
        this._handle(msg);
      } catch (err) {
        this.emit("log", `Error handling line ${JSON.stringify(line)}: ${err.stack || err}`);
      }
    }
  }

  _handle(msg) {
    const { command, args } = msg;

    switch (command) {
      case "PING":
        // Also covers QuakeNet's pre-registration PING cookie
        this._send("PONG", args[args.length - 1] || "");
        break;

      case "001": // RPL_WELCOME
        this.registered = true;
        this.nick = args[0] || this.nick;
        this.reconnectDelay = RECONNECT_MIN_MS;
        this.lastReclaimCheck = this.now(); // first ISON check one interval from now
        this.emit("registered", this.nick);
        if (this.opt.channel) this._send("JOIN", this.opt.channel);
        break;

      case "005": // RPL_ISUPPORT
        for (const token of args.slice(1, -1)) {
          const m = token.match(/^NICKLEN=(\d+)$/i);
          if (m) this.nickLen = parseInt(m[1], 10);
        }
        break;

      case "432": // ERR_ERRONEUSNICKNAME
      case "433": // ERR_NICKNAMEINUSE
      case "437": // ERR_UNAVAILRESOURCE
        this._onNickRejected(command, args[1]);
        break;

      case "303": { // RPL_ISON — space-separated list of the queried nicks that are online
        const online = (args[1] || "").split(" ").filter(Boolean);
        if (!online.some((n) => sameNick(n, this.desiredNick))) {
          this._tryReclaim("not online per ISON");
        }
        break;
      }

      case "NICK": {
        const newNick = args[0];
        if (sameNick(msg.nick, this.nick)) {
          this.nick = newNick;
          this.emit("nick", this.nick);
        } else if (sameNick(msg.nick, this.desiredNick)) {
          this._tryReclaim(`holder renamed to "${newNick}"`);
        }
        break;
      }

      case "QUIT":
        if (sameNick(msg.nick, this.desiredNick) && !this.hasDesiredNick()) {
          this._tryReclaim("holder quit");
        }
        break;

      case "JOIN":
        if (sameNick(msg.nick, this.nick)) this.emit("joined", args[0]);
        break;

      case "KICK":
        if (sameNick(args[1], this.nick)) {
          this.emit("log", `Kicked from ${args[0]} by ${msg.nick}: ${args[2] || ""}`);
          const channel = args[0];
          setTimeout(() => {
            if (this.registered) this._send("JOIN", channel);
          }, REJOIN_DELAY_MS);
        }
        break;

      case "ERROR":
        this.emit("log", `Server ERROR: ${args.join(" ")}`);
        break;
    }

    this.emit("message", msg);
  }

  _onNickRejected(code, rejected) {
    if (this.registered) {
      // A reclaim attempt lost a race. The server keeps our current nick, so
      // just do nothing — the next ISON / QUIT / NICK will try again.
      this.emit("log", `Could not take "${rejected}" (${code}), staying as "${this.nick}"`);
      return;
    }
    // During registration we have no nick yet and must pick another one.
    this.fallbackAttempt++;
    this.nick = fallbackNick(this.desiredNick, this.fallbackAttempt, this.opt.nickSuffix, this.nickLen);
    this.emit("log", `Nick "${rejected}" unavailable (${code}), trying "${this.nick}"`);
    this._send("NICK", this.nick);
  }

  // ─── Outgoing ──────────────────────────────────────────────────────

  _send(command, ...params) {
    if (!this.socket || this.socket.destroyed) return false;
    const line = buildLine(command, ...params);
    this.socket.write(line + "\r\n");
    return true;
  }

  /** Send a PRIVMSG. CR/LF are stripped so text can never inject extra commands. */
  say(target, text) {
    if (!this.registered) return false;
    let body = stripLineBreaks(text);
    // Leave room for the ":nick!user@host " prefix the server adds when relaying
    const overhead = Buffer.byteLength(`PRIVMSG ${target} :`) + 100;
    while (Buffer.byteLength(body) > MAX_LINE_BYTES - overhead) body = body.slice(0, -1);
    return this._send("PRIVMSG", target, body);
  }
}

module.exports = IrcClient;
