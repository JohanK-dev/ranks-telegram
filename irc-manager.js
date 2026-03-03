const irc = require("irc");
const EventEmitter = require("events");
const parseQuestion = require("./parseQuestion");

class IrcManager extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.client = null;
    this.connected = false;
  }

  connect() {
    console.log(
      `[IRC] Connecting to ${this.config.server} as ${this.config.nickname}...`
    );

    this.client = new irc.Client(this.config.server, this.config.nickname, {
      port: this.config.port,
      channels: [this.config.channel],
      autoRejoin: true,
      autoConnect: true,
      retryCount: 10,
      retryDelay: 5000,
      stripColors: false, // Need IRC color codes to identify the red equation
      encoding: "utf-8",
      userName: this.config.nickname,
      realName: "Ranks Scoring Bot",
    });

    this.client.addListener("registered", () => {
      console.log("[IRC] Connected and registered on QuakeNet");
      this.connected = true;
      this.emit("connected");
    });

    this.client.addListener("join", (channel, nick) => {
      if (nick === this.config.nickname) {
        console.log(`[IRC] Joined ${channel}`);
        this.emit("joined", channel);
      }
    });

    this.client.addListener("raw", (message) => {
      this._handleRawMessage(message);
    });

    this.client.addListener("error", (error) => {
      console.error("[IRC] Error:", error.command, error.args?.join(" "));
    });

    this.client.addListener("netError", (error) => {
      console.error("[IRC] Network error:", error.message);
      this.connected = false;
    });

    this.client.addListener("abort", () => {
      console.error("[IRC] Connection aborted after max retries");
      this.connected = false;
      setTimeout(() => this.connect(), 30000);
    });
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
    this.client.say(this.config.machineNick, answer);
    return true;
  }

  disconnect() {
    if (this.client) {
      this.client.disconnect("Leaving");
      this.connected = false;
    }
  }
}

module.exports = IrcManager;