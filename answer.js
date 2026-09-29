// Pure helper for turning a Telegram reply into the text sent to IRC.
//
// Space-separated multiplication shortcut (e.g. "5 3" → "15").
// Anything else is passed through trimmed.
function normalizeAnswer(text) {
  const trimmed = String(text).trim();
  const parts = trimmed.split(" ");
  if (parts.length === 2) {
    const n1 = parseFloat(parts[0]);
    const n2 = parseFloat(parts[1]);
    if (!isNaN(n1) && !isNaN(n2)) {
      return String(n1 * n2);
    }
  }
  return trimmed;
}

module.exports = { normalizeAnswer };
