const config = require("./config");
const IrcManager = require("./irc-manager");
const TelegramManager = require("./telegram-manager");

// ─── Initialize components ───────────────────────────────────────────
const ircManager = new IrcManager(config.irc);
const telegram = new TelegramManager(config.telegram);

// ─── Telegram → IRC (answers) ────────────────────────────────────────
telegram.onAnswer = (answer) => {
  const text = String(answer);

  // Handle space-separated multiplication shortcut (e.g. "5 3" sends "15")
  const parts = text.trim().split(" ");
  if (parts.length === 2) {
    const n1 = parseFloat(parts[0]);
    const n2 = parseFloat(parts[1]);
    if (!isNaN(n1) && !isNaN(n2)) {
      const result = String(n1 * n2);
      ircManager.sendAnswer(result);
      telegram.sendAnswerConfirmation(result);
      return;
    }
  }

  ircManager.sendAnswer(text);
  telegram.sendAnswerConfirmation(text);
};

// ─── Status request handler ──────────────────────────────────────────
telegram.onStatusRequest = () => {
  return (
    `*Status*\n\n` +
    `IRC: ${ircManager.connected ? "Connected" : "Disconnected"}\n` +
    `Server: ${config.irc.server}\n` +
    `Channel: ${config.irc.channel}\n` +
    `Nick: ${config.irc.nickname}\n` +
    `Question active: ${telegram.activeQuestion ? "Yes" : "No"}`
  );
};

// ─── IRC → Telegram (events) ─────────────────────────────────────────
ircManager.on("connected", () => {
  console.log("[SERVER] IRC connected");
});

ircManager.on("scoring-alert", () => {
  console.log("[SERVER] Scoring alert");
  telegram.sendScoringAlert();
});

ircManager.on("question", (question) => {
  console.log("[SERVER] Question → Telegram");
  telegram.sendQuestion(question);
});

ircManager.on("question-error", (error) => {
  console.error("[SERVER] Question parse failed → Telegram");
  telegram.sendQuestionError(error.error);
});

ircManager.on("scoring-over", () => {
  console.log("[SERVER] Scoring over");
  telegram.sendScoringOver();
});

// ─── Start everything ────────────────────────────────────────────────
console.log("[SERVER] Starting Ranks Scoring Telegram Bot...");
telegram.start();
ircManager.connect();

// Shutdown
process.on("SIGINT", () => {
  console.log("\n[SERVER] Shutting down...");
  telegram.stop();
  ircManager.disconnect();
  process.exit(0);
});

process.on("uncaughtException", (err) => {
  console.error("[SERVER] Uncaught exception:", err);
});
