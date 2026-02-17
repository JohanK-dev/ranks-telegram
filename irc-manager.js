const irc = require("irc");
const EventEmitter = require("events");

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
    // Message format from MACHINE[]:
    //   "Please /MSG me the answer of the RED text  5+3  7+4  \x03044+9"
    // "logic":
    // 1. Find all colored equations and track their positions
    // 2. Strip all IRC color codes from the text
    // 3. Find all equations in the stripped text
    // 4. Mark the one that was red

    // IRC color: \x03 followed by 1-2 digit code, optionally a comma and background color
    const colorPattern = /\x03(\d{1,2})(?:,\d{1,2})?/g;
    const colorPositions = new Map();

    let stripped = "";
    let lastIndex = 0;
    let colorMatch;

    const colorCodes = [];
    while ((colorMatch = colorPattern.exec(text)) !== null) {
      colorCodes.push({
        originalIndex: colorMatch.index,
        length: colorMatch[0].length,
        colorCode: parseInt(colorMatch[1]),
      });
    }

    // Strip all IRC formatting codes (\x03 colors, \x02 bold, \x0F reset, \x1D italic, \x1F underline)
    stripped = text.replace(/\x03(\d{1,2}(?:,\d{1,2})?)?|\x02|\x0F|\x1D|\x1F/g, "");

    // Find all equations in the stripped text
    const equationPattern = /\b(\d+[+\-*\/]\d+)\b/g;
    const equations = [];
    let eqMatch;

    while ((eqMatch = equationPattern.exec(stripped)) !== null) {
      equations.push({
        equation: eqMatch[1],
        isRed: false,
        colorCode: -1,
        strippedIndex: eqMatch.index,
      });
    }

    // Determine which equation is red by checking if \x0304 precedes it in the original
    for (const eq of equations) {
      const redBeforeEq = new RegExp(
        `\\x0304\\s*${eq.equation.replace(/([+*\\/])/g, "\\$1")}`,
      );
      if (redBeforeEq.test(text)) {
        eq.isRed = true;
        eq.colorCode = 4;
      }
    }

    // ─── Validation ──────────────────────────────────────────
    if (equations.length === 0) {
      return {
        success: false,
        error: `No equations found in message at all. Expected patterns like "5+3", "12-4", "3*7".`,
      };
    }

    const redEquations = equations.filter((eq) => eq.isRed);

    if (redEquations.length === 0) {
      return {
        success: false,
        error: `Found ${equations.length} equation(s) [${equations.map((e) => e.equation).join(", ")}] but none was preceded by red color code (\\x0304). Cannot determine which to answer.`,
      };
    }

    if (redEquations.length > 1) {
      return {
        success: false,
        error: `Found ${redEquations.length} red equations — ambiguous. Expected exactly 1. Equations: [${redEquations.map((e) => e.equation).join(", ")}]`,
      };
    }

    // Clean up internal tracking fields
    const cleanEquations = equations.map(({ equation, isRed, colorCode }) => ({
      equation,
      isRed,
      colorCode,
    }));

    return {
      success: true,
      question: {
        equations: cleanEquations,
        redEquation: cleanEquations.find((eq) => eq.isRed),
        raw: text,
        timestamp: Date.now(),
      },
    };
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
