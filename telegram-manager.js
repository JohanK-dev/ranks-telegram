const TelegramBot = require("node-telegram-bot-api");

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

    this.bot = new TelegramBot(this.config.botToken, { polling: true });
    console.log("[TG] Bot started, polling for messages...");

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
      );
    });

    // Handle /status command
    this.bot.onText(/\/status/, (msg) => {
      if (!this._isAllowed(msg.from.id)) return;

      const paused = this.pausedUsers.has(msg.from.id);
      const status = this.onStatusRequest ? this.onStatusRequest() : "Unknown";
      const pauseStatus = paused ? "\nNotifications: ⏸ Paused" : "\nNotifications: ▶ Active";

      this.bot.sendMessage(msg.chat.id, status + pauseStatus, { parse_mode: "Markdown" });
    });

    // Handle /pause command
    this.bot.onText(/\/pause/, (msg) => {
      if (!this._isAllowed(msg.from.id)) return;

      this.pausedUsers.add(msg.from.id);
      console.log(`[TG] User ${msg.from.id} paused notifications`);
      this.bot.sendMessage(msg.chat.id, "⏸ Notifications paused. Use /resume to start receiving questions again.");
    });

    // Handle /resume command
    this.bot.onText(/\/resume/, (msg) => {
      if (!this._isAllowed(msg.from.id)) return;

      this.pausedUsers.delete(msg.from.id);
      console.log(`[TG] User ${msg.from.id} resumed notifications`);
      this.bot.sendMessage(msg.chat.id, "▶ Notifications resumed. You will receive scoring questions again.");
    });

    // Handle all other messages as potential answers
    this.bot.on("message", (msg) => {
      if (msg.text && msg.text.startsWith("/")) return;
      if (!this._isAllowed(msg.from.id)) return;

      const text = (msg.text || "").trim();
      if (!text) return;

      if (!this.activeQuestion) {
        this.bot.sendMessage(msg.chat.id, "No active question right now.");
        return;
      }

      console.log(`[TG] Answer received from ${msg.from.id}: ${text}`);

      if (this.onAnswer) {
        this.onAnswer(text);
      }

      this.activeQuestion = null;
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

  async sendAnswerConfirmation(answer) {
    console.log(`[TG] Answer sent: ${answer}`);
  }

  stop() {
    if (this.bot) {
      this.bot.stopPolling();
    }
  }
}

module.exports = TelegramManager;
