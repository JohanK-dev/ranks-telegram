const TelegramBot = require("node-telegram-bot-api");

// Tolerance for clock skew between this machine and Telegram, and for
// msg.date only having second precision.
const STALE_ANSWER_SLACK_MS = 5000;

class TelegramManager {
  constructor(config) {
    this.config = config;
    this.bot = null;
    this.activeQuestion = null;
    this.onAnswer = null;
    this.onStatusRequest = null;
    this.pausedUsers = new Set();
  }

  start() {
    if (!this.config.botToken) {
      console.error("[TG] No bot token configured! Get one from @BotFather");
      console.error("[TG] Then set telegram.botToken in config.js");
      process.exit(1);
    }

    this.bot = new TelegramBot(this.config.botToken, {
      polling: true,
      // The underlying HTTP client has no timeout by default and reuses
      // keep-alive sockets (`forever: true`). If a connection dies silently
      // mid-poll (e.g. router reboot, dropped NAT entry) instead of closing
      // cleanly, the in-flight getUpdates request can hang forever — no
      // error, no retry, polling just stalls permanently. This timeout
      // bounds every request so a dead connection eventually errors out and
      // the library's built-in retry loop takes back over. Kept above the
      // 10s long-poll hold Telegram's server does for getUpdates.
      request: { timeout: 15000 },
    });
    console.log("[TG] Bot started, polling for messages...");

    this.bot.on("polling_error", (err) => {
      console.error("[TG] Polling error:", err.message);
    });

    // Handle /start command
    this.bot.onText(/\/start/, (msg) => {
      const chatId = msg.chat.id;
      const userId = msg.from.id;
      console.log(`[TG] /start from user ${userId} (chat ${chatId})`);

      this.bot.sendMessage(
        chatId,
        `<b>Ranks Scoring Bot</b>\n\n` +
        `Your user ID: <code>${userId}</code>\n\n` +
        `Add this ID to <code>allowedUserIds</code> in config.js to authorize this account.\n\n` +
        `<b>Commands:</b>\n` +
        `/status — connection status\n` +
        `/pause — stop receiving questions\n` +
        `/resume — start receiving questions again`,
        { parse_mode: "HTML" }
      ).catch((err) => {
        console.error(`[TG] Failed to send /start reply to ${chatId}:`, err.message);
      });
    });

    // Handle /status command
    this.bot.onText(/\/status/, (msg) => {
      if (!this._isAllowed(msg.from.id)) return;

      const paused = this.pausedUsers.has(msg.from.id);
      const status = this.onStatusRequest ? this.onStatusRequest() : "Unknown";
      const pauseStatus = paused ? "\nNotifications: ⏸ Paused" : "\nNotifications: ▶ Active";

      this.bot.sendMessage(msg.chat.id, status + pauseStatus, { parse_mode: "Markdown" }).catch((err) => {
        console.error(`[TG] Failed to send /status reply to ${msg.chat.id}:`, err.message);
      });
    });

    // Handle /pause command
    this.bot.onText(/\/pause/, (msg) => {
      if (!this._isAllowed(msg.from.id)) return;

      this.pausedUsers.add(msg.from.id);
      console.log(`[TG] User ${msg.from.id} paused notifications`);
      this.bot.sendMessage(msg.chat.id, "⏸ Notifications paused. Use /resume to start receiving questions again.").catch((err) => {
        console.error(`[TG] Failed to send /pause reply to ${msg.chat.id}:`, err.message);
      });
    });

    // Handle /resume command
    this.bot.onText(/\/resume/, (msg) => {
      if (!this._isAllowed(msg.from.id)) return;

      this.pausedUsers.delete(msg.from.id);
      console.log(`[TG] User ${msg.from.id} resumed notifications`);
      this.bot.sendMessage(msg.chat.id, "▶ Notifications resumed. You will receive scoring questions again.").catch((err) => {
        console.error(`[TG] Failed to send /resume reply to ${msg.chat.id}:`, err.message);
      });
    });

    // Handle all other messages as potential answers
    this.bot.on("message", (msg) => {
      if (msg.text && msg.text.startsWith("/")) return;
      if (!this._isAllowed(msg.from.id)) return;

      const text = (msg.text || "").trim();
      if (!text) return;

      const question = this.activeQuestion;
      if (!question) {
        this._reply(msg.chat.id, "No active question right now.");
        return;
      }

      // msg.date is when Telegram received the message (second precision).
      const sentAt = msg.date * 1000;
      const age = ((question.timestamp - sentAt) / 1000).toFixed(0);
      console.log(`[TG] Answer received from ${msg.from.id}: ${text} (sent ${new Date(sentAt).toISOString()}, question ${new Date(question.timestamp).toISOString()})`);

      // A message sent before the question existed can't be an answer to it
      // (e.g. a backlog of updates delivered after the bot reconnects).
      if (sentAt < question.timestamp - STALE_ANSWER_SLACK_MS) {
        console.warn(`[TG] Ignoring stale answer "${text}", sent ${age}s before the question`);
        this._reply(msg.chat.id, `Ignored "${text}": it was sent before the current question. Answer again.`);
        return;
      }

      const result = this.onAnswer ? this.onAnswer(text, question) : { sent: true, answer: text };
      if (!result.sent) {
        this._reply(msg.chat.id, `⚠️ ${result.reason}`);
        return;
      }
      this.sendAnswerConfirmation(msg.chat.id, result.answer);

      // Only clear if a newer question hasn't replaced it meanwhile
      if (this.activeQuestion === question) {
        this.activeQuestion = null;
      }
    });
  }

  _reply(chatId, text) {
    this.bot.sendMessage(chatId, text).catch((err) => {
      console.error(`[TG] Failed to send reply to ${chatId}:`, err.message);
    });
  }

  _isAllowed(userId) {
    if (!this.config.allowedUserIds || this.config.allowedUserIds.length === 0) {
      return true;
    }
    return this.config.allowedUserIds.includes(userId);
  }

  _getActiveChatIds() {
    const all = this.config.allowedUserIds || [];
    return all.filter((id) => !this.pausedUsers.has(id));
  }

  async sendScoringAlert() {
    // Uncomment below to receive a Telegram notification when scoring starts. Use same pattern in sendScoringOver() and other methods if desired.
    // const chatIds = this._getActiveChatIds();
    // for (const chatId of chatIds) {
    //   this.bot.sendMessage(chatId, "Scoring time!").catch(() => {});
    // }
    console.log("[TG] Scoring alert (no notification sent)");
  }

  async sendQuestion(question) {
    this.activeQuestion = question;

    const lines = [];

    for (const eq of question.equations) {
      if (eq.isRed) {
        lines.push(`🔴  <b>${eq.equation}</b>`);
      } else {
        lines.push(`⚪  ${eq.equation}`);
      }
    }

    const message = lines.join("\n");
    const chatIds = this._getActiveChatIds();

    if (chatIds.length === 0) {
      console.log("[TG] No active users to send question to (all paused)");
      return;
    }

    for (const chatId of chatIds) {
      this.bot.sendMessage(chatId, message, { parse_mode: "HTML" }).catch((err) => {
        console.error(`[TG] Failed to send question to ${chatId}:`, err.message);
      });
    }
  }

  async sendQuestionError(error) {
    const text = `<b>Question parse failed</b>\n\n<code>${error}</code>\n\n<i>No answer sent.</i>`;
    const chatIds = this._getActiveChatIds();

    for (const chatId of chatIds) {
      this.bot.sendMessage(chatId, text, { parse_mode: "HTML" }).catch((err) => {
        console.error(`[TG] Failed to send error to ${chatId}:`, err.message);
      });
    }
  }

  async sendScoringOver() {
    this.activeQuestion = null;
    console.log("[TG] Scoring over — question cleared (no notification sent)");
  }

  // Confirms each forwarded answer, so a reply that never arrives (e.g.
  // stuck in the phone's outbox) is noticeable by the missing confirmation.
  async sendAnswerConfirmation(chatId, answer) {
    console.log(`[TG] Answer sent: ${answer}`);
    this._reply(chatId, `✅ Sent: ${answer}`);
  }

  stop() {
    if (this.bot) {
      this.bot.stopPolling();
    }
  }
}

module.exports = TelegramManager;
