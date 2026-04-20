module.exports = {
  // IRC settings. Rename this to Config.js to start using
  irc: {
    server: "irc.quakenet.org",
    port: 6667,
    nickname: "YourNick",        // Your IRC nickname
    channel: "#Ranks",
    machineNick: "MACHINE[]",    // The bot that sends scoring questions
  },

  // Telegram settings
  telegram: {
    botToken: "",                // Get from @BotFather on Telegram
    allowedUserIds: [],          // Your Telegram user ID(s) — only these users can interact. Send /start to the bot, it will tell you your ID
  },
};
