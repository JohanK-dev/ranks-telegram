const config = require("./config");
const IrcManager = require("./irc-manager");
const TelegramManager = require("./telegram-manager");
const { normalizeAnswer } = require("./answer");

// ─── Initialize components ───────────────────────────────────────────
const ircManager = new IrcManager(config.irc);
const telegram = new TelegramManager(config.telegram);

// ─── Telegram → IRC (answers) ────────────────────────────────────────
// Returns { sent, answer } or { sent: false, reason }. When not sent, the question stays active so
// the user can try again. The answer is never checked for correctness —
// see CLAUDE.md ("Game rules").
telegram.onAnswer = (text) => {
  const answer = normalizeAnswer(text);

  if (!ircManager.sendAnswer(answer)) {
    return { sent: false, reason: "IRC is not connected. Not sent, try again." };
  }
  return { sent: true, answer };
};

// ─── Status request handler ──────────────────────────────────────────
telegram.onStatusRequest = () => {
  return (
    `*Status*\n\n` +
    `IRC: ${ircManager.connected ? "Connected" : "Disconnected"}\n` +
    `Server: ${config.irc.server}\n` +
    `Channel: ${config.irc.channel}\n` +
    `Nick: ${ircManager.currentNick || config.irc.nickname}` +
    (ircManager.currentNick && ircManager.currentNick !== config.irc.nickname
      ? ` (reclaiming ${config.irc.nickname})`
      : "") +
    `\n` +
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
