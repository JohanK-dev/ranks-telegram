// Pure IRC protocol helpers (no I/O) — kept separate so they can be unit tested.

const DEFAULT_NICKLEN = 15; // QuakeNet's NICKLEN; updated from RPL_ISUPPORT (005) if sent

/**
 * Parse one IRC line (without CRLF) into
 * { prefix, nick, user, host, command, args }. Returns null for garbage.
 */
function parseLine(line) {
  let rest = line;
  let prefix = null;

  // IRCv3 message tags — QuakeNet doesn't send them, but skip safely if present
  if (rest.startsWith("@")) {
    const i = rest.indexOf(" ");
    if (i < 0) return null;
    rest = rest.slice(i + 1).replace(/^ +/, "");
  }

  if (rest.startsWith(":")) {
    const i = rest.indexOf(" ");
    if (i < 0) return null;
    prefix = rest.slice(1, i);
    rest = rest.slice(i + 1).replace(/^ +/, "");
  }

  const args = [];
  while (rest.length > 0) {
    if (rest.startsWith(":")) {
      args.push(rest.slice(1));
      break;
    }
    const i = rest.indexOf(" ");
    if (i < 0) {
      args.push(rest);
      break;
    }
    args.push(rest.slice(0, i));
    rest = rest.slice(i + 1).replace(/^ +/, "");
  }

  const command = args.shift();
  if (!command) return null;

  let nick = null;
  let user = null;
  let host = null;
  if (prefix) {
    const m = prefix.match(/^([^!@]+)(?:!([^@]+))?(?:@(.+))?$/);
    if (m) [, nick, user, host] = m;
  }

  return { prefix, nick, user, host, command: command.toUpperCase(), args };
}

/** RFC1459 case mapping (what QuakeNet uses): []\~ are uppercase of {}|^ */
function ircLower(s) {
  return String(s)
    .toLowerCase()
    .replace(/\[/g, "{")
    .replace(/\]/g, "}")
    .replace(/\\/g, "|")
    .replace(/~/g, "^");
}

function sameNick(a, b) {
  if (a == null || b == null) return false;
  return ircLower(a) === ircLower(b);
}

/**
 * The n-th (1-based) fallback nick: the desired nick with `suffix` appended
 * n times, e.g. "Jappe2{" → "Jappe2{{" → "Jappe2{{{". If that would exceed
 * NICKLEN the base is shortened instead — the server would otherwise
 * silently truncate it back into the nick that is already taken.
 */
function fallbackNick(nick, attempt, suffix = "{", nickLen = DEFAULT_NICKLEN) {
  const tail = suffix.repeat(attempt);
  if (tail.length >= nickLen) {
    // Absurdly many collisions — fall back to random digits
    const digits = String(Math.floor(Math.random() * 1e6));
    return nick.slice(0, Math.max(1, nickLen - digits.length)) + digits;
  }
  return nick.slice(0, nickLen - tail.length) + tail;
}

/** Remove characters that would let text break out of an IRC line (CR/LF injection). */
function stripLineBreaks(s) {
  return String(s).replace(/[\r\n\0]/g, " ");
}

/**
 * Build a raw line from a command and params, refusing anything that could
 * smuggle in an extra command. Only the last param may contain spaces.
 */
function buildLine(command, ...params) {
  if (!/^[A-Za-z]+$|^\d{3}$/.test(command)) {
    throw new Error(`Invalid IRC command: ${command}`);
  }
  const parts = [command];
  params.forEach((p, i) => {
    const value = stripLineBreaks(p);
    const isLast = i === params.length - 1;
    if (!isLast && (value === "" || /[ ]/.test(value) || value.startsWith(":"))) {
      throw new Error(`Invalid middle IRC param: ${JSON.stringify(value)}`);
    }
    parts.push(isLast && (value === "" || / /.test(value) || value.startsWith(":")) ? ":" + value : value);
  });
  return parts.join(" ");
}

module.exports = {
  DEFAULT_NICKLEN,
  parseLine,
  ircLower,
  sameNick,
  fallbackNick,
  stripLineBreaks,
  buildLine,
};
