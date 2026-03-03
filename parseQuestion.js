function parseQuestion(text) {
  // Format is always: ...\x03CC equation \x03CC equation \x03CC equation
  // where CC is the color code. Red = 04.
  // Split on \x03 to get segments like "04 6*19 " or "15 2*5 "
  const segments = text.split("\x03");
  const equationPattern = /(\d+[+\-*\/]\d+)/;
  const results = [];

  for (const segment of segments) {
    const eqMatch = segment.match(equationPattern);
    if (!eqMatch) continue;

    results.push({
      equation: eqMatch[1],
      isRed: segment.startsWith("04"),
    });
  }

  if (results.length === 0) {
    return { success: false, error: "No equations found in message." };
  }

  const redEquation = results.find((eq) => eq.isRed);

  if (!redEquation) {
    return { success: false, error: `Found ${results.length} equation(s) but none was red.` };
  }

  if (results.filter((eq) => eq.isRed).length > 1) {
  return { success: false, error: "Multiple red equations found — ambiguous." };
}

  return {
    success: true,
    question: {
      equations: results,
      redEquation,
      raw: text,
      timestamp: Date.now(),
    },
  };
}

module.exports = parseQuestion;