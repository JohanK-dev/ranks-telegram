const EventEmitter = require("events");
const IrcClient = require("./irc-client");
const parseQuestion = require("./parseQuestion");

class IrcManager extends EventEmitter {
  constructor(config, deps = {}) {
    super();
    this.config = config;
    this.deps = deps; // injectable socket factory for tests
    this.client = null;
    this.connected = false;
  }

  /** Nick we currently hold on IRC (may be a fallback until reclaimed). */
  get currentNick() {
    return this.client ? this.client.nick : null;
  }

  connect() {
    console.log(
      `[IRC] Connecting to ${this.config.server} as ${this.config.nickname}...`
    );

    this.client = new IrcClient(
      {
        server: this.config.server,
        port: this.config.port,
        nickname: this.config.nickname,
        nickSuffix: this.config.nickSuffix || "{",
        userName: this.config.nickname,
        realName: "Ranks Scoring Bot",
        channel: this.config.channel,
      },
      this.deps
    );

    this.client.on("log", (text) => console.log(`[IRC] ${text}`));

    this.client.on("registered", (nick) => {
      console.log("[IRC] Connected and registered on QuakeNet");
      this.connected = true;
      if (!this.client.hasDesiredNick()) {
        // Reclaimed automatically by IrcClient once the server reports the
        // nick free (periodic ISON check, or the holder's QUIT/NICK).
        console.log(`[IRC] Registered as "${nick}", will reclaim "${this.config.nickname}" once it frees up`);
      }
      this.emit("connected");
    });

    this.client.on("nick", (nick) => {
      console.log(`[IRC] Now known as "${nick}"`);
    });

    this.client.on("joined", (channel) => {
      console.log(`[IRC] Joined ${channel}`);
      this.emit("joined", channel);
    });

    this.client.on("message", (message) => this._handleRawMessage(message));

    this.client.on("netError", (error) => {
      console.error("[IRC] Network error:", error.message);
    });

    this.client.on("disconnected", () => {
      this.connected = false;
    });

    this.client.connect();
  }

  _handleRawMessage(message) {
    const nick = message.nick || "";
    const text = (message.args && message.args[message.args.length - 1]) || "";

    if (nick !== this.config.machineNick) return;

    // Scoring announcement
    if (text.includes("IT IS SCORING TIME")) {
      console.log("[IRC] Scoring time detected!");
      this.emit("scoring-alert");
    }

    // Scoring ended
    if (text.includes("Scoring over")) {
      console.log("[IRC] Scoring over detected");
      this.emit("scoring-over");
    }

    // The actual math question
    if (text.includes("Please") && text.includes("answer")) {
      console.log("[IRC] Raw question message (hex):", Buffer.from(text).toString("hex"));
      console.log("[IRC] Raw question message (escaped):", JSON.stringify(text));

      const result = this._parseQuestion(text);

      if (result.success) {
        console.log("[IRC] Parsed question:", JSON.stringify(result.question));
        this.emit("question", result.question);
      } else {
        console.error("[IRC] PARSE FAILED:", result.error);
        console.error("[IRC] Raw message was:", JSON.stringify(text));
        this.emit("question-error", {
          error: result.error,
          raw: text,
          timestamp: Date.now(),
        });
      }
    }
  }

  _parseQuestion(text) {
    return parseQuestion(text);
  }

  sendAnswer(answer) {
    if (!this.connected || !this.client) {
      console.error("[IRC] Cannot send answer — not connected");
      return false;
    }

    console.log(`[IRC] Sending answer to ${this.config.machineNick}: ${answer}`);
    return this.client.say(this.config.machineNick, answer);
  }

  disconnect() {
    if (this.client) {
      this.client.quit("Leaving");
      this.connected = false;
    }
  }
}

module.exports = IrcManager;