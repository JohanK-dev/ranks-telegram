const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert");
const EventEmitter = require("events");
const IrcClient = require("../irc-client");
const { parseLine, sameNick, fallbackNick, buildLine } = require("../irc-protocol");

class FakeSocket extends EventEmitter {
  constructor() {
    super();
    this.written = [];
    this.destroyed = false;
  }
  setEncoding() {}
  setKeepAlive() {}
  write(data) {
    this.written.push(...data.split("\r\n").filter(Boolean));
  }
  end() {}
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit("close");
  }
  recv(...lines) {
    this.emit("data", lines.map((l) => l + "\r\n").join(""));
  }
}

let clients = [];
afterEach(() => {
  for (const c of clients) {
    c.stopped = true;
    if (c.socket) c.socket.destroy();
    clearInterval(c.tickTimer);
    clearTimeout(c.reconnectTimer);
  }
  clients = [];
});

function setup(nickname = "Jappe2{") {
  let clock = 1_000_000;
  const sockets = [];
  const client = new IrcClient(
    { server: "irc.test", port: 6667, nickname, channel: "#ranks" },
    {
      createConnection: () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      },
      now: () => clock,
    }
  );
  client.on("log", () => {});
  clients.push(client);
  client.connect();
  const sock = sockets[0];
  sock.emit("connect");
  return {
    client,
    sock,
    advance: (ms) => (clock += ms),
  };
}

describe("irc-protocol", () => {
  it("parses prefix, command and trailing", () => {
    const m = parseLine(":MACHINE[]!m@host PRIVMSG Jappe2{ :Please answer: 1+2");
    assert.strictEqual(m.nick, "MACHINE[]");
    assert.strictEqual(m.command, "PRIVMSG");
    assert.deepStrictEqual(m.args, ["Jappe2{", "Please answer: 1+2"]);
  });

  it("parses lines without prefix", () => {
    assert.deepStrictEqual(parseLine("PING :12345").args, ["12345"]);
  });

  it("compares nicks with RFC1459 case mapping", () => {
    assert.ok(sameNick("Jappe2{", "JAPPE2["));
    assert.ok(!sameNick("Jappe2{", "Jappe2{{"));
  });

  it("builds fallback nicks by appending the suffix, within NICKLEN", () => {
    assert.strictEqual(fallbackNick("Jappe2{", 1), "Jappe2{{");
    assert.strictEqual(fallbackNick("Jappe2{", 2), "Jappe2{{{");
    assert.strictEqual(fallbackNick("ABCDEFGHIJKLMNO", 1), "ABCDEFGHIJKLMN{");
  });

  it("strips CR/LF so text cannot inject commands", () => {
    assert.strictEqual(buildLine("PRIVMSG", "MACHINE[]", "42\r\nQUIT :x"), "PRIVMSG MACHINE[] :42  QUIT :x");
  });

  it("rejects spaces in middle params", () => {
    assert.throws(() => buildLine("PRIVMSG", "a b", "hi"));
  });
});

describe("IrcClient", () => {
  it("registers with NICK and USER", () => {
    const { sock } = setup();
    assert.deepStrictEqual(sock.written, ["NICK Jappe2{", "USER Jappe2{ 0 * :Ranks Scoring Bot"]);
  });

  it("answers the pre-registration PING cookie", () => {
    const { sock } = setup();
    sock.recv("PING :3829412");
    assert.strictEqual(sock.written.at(-1), "PONG 3829412");
  });

  it("falls back to <nick>{ (not <nick>1) when the nick is taken at connect", () => {
    const { client, sock } = setup();
    sock.recv(":server 433 * Jappe2{ :Nickname is already in use.");
    assert.strictEqual(sock.written.at(-1), "NICK Jappe2{{");
    sock.recv(":server 433 * Jappe2{{ :Nickname is already in use.");
    assert.strictEqual(sock.written.at(-1), "NICK Jappe2{{{");
    sock.recv(":server 001 Jappe2{{{ :Welcome");
    assert.strictEqual(client.nick, "Jappe2{{{");
    assert.strictEqual(sock.written.at(-1), "JOIN #ranks");
  });

  it("does not rename itself when a reclaim collides after registration", () => {
    const { client, sock } = setup();
    sock.recv(":server 433 * Jappe2{ :in use", ":server 001 Jappe2{{ :Welcome");
    const before = sock.written.length;
    sock.recv(":server 433 Jappe2{{ Jappe2{ :Nickname is already in use.");
    assert.strictEqual(sock.written.length, before);
    assert.strictEqual(client.nick, "Jappe2{{");
  });

  it("reclaims when the holder quits", () => {
    const { client, sock } = setup();
    sock.recv(":server 433 * Jappe2{ :in use", ":server 001 Jappe2{{ :Welcome");
    sock.recv(":Jappe2{!~Jappe2{@host QUIT :Ping timeout");
    assert.strictEqual(sock.written.at(-1), "NICK Jappe2{");
    sock.recv(":Jappe2{{!~Jappe2{@host NICK :Jappe2{");
    assert.strictEqual(client.nick, "Jappe2{");
    assert.ok(client.hasDesiredNick());
  });

  it("reclaims when the holder renames away", () => {
    const { sock } = setup();
    sock.recv(":server 433 * Jappe2{ :in use", ":server 001 Jappe2{{ :Welcome");
    sock.recv(":Jappe2{!~u@host NICK :someone");
    assert.strictEqual(sock.written.at(-1), "NICK Jappe2{");
  });

  it("checks with ISON and reclaims only when the nick is reported free", () => {
    const { client, sock, advance } = setup();
    sock.recv(":server 433 * Jappe2{ :in use", ":server 001 Jappe2{{ :Welcome");

    advance(31_000);
    sock.recv(":server NOTICE Jappe2{{ :keep the idle timer fresh");
    client._tick();
    assert.strictEqual(sock.written.at(-1), "ISON Jappe2{");

    // Still online (ghost of our old connection) → no NICK
    sock.recv(":server 303 Jappe2{{ :Jappe2{");
    assert.strictEqual(sock.written.at(-1), "ISON Jappe2{");

    // Ghost timed out without us seeing its QUIT → reclaim
    advance(31_000);
    sock.recv(":server NOTICE Jappe2{{ :fresh");
    client._tick();
    sock.recv(":server 303 Jappe2{{ :");
    assert.strictEqual(sock.written.at(-1), "NICK Jappe2{");
  });

  it("does not send ISON while holding the desired nick", () => {
    const { client, sock, advance } = setup();
    sock.recv(":server 001 Jappe2{ :Welcome");
    advance(31_000);
    sock.recv(":server NOTICE Jappe2{ :fresh");
    client._tick();
    assert.ok(!sock.written.some((l) => l.startsWith("ISON")));
  });

  it("drops a dead connection after long silence", () => {
    const { client, sock, advance } = setup();
    sock.recv(":server 001 Jappe2{ :Welcome");
    advance(100_000);
    client._tick();
    assert.strictEqual(sock.written.at(-1), "PING keepalive");
    advance(100_000);
    client._tick();
    assert.ok(sock.destroyed);
  });

  it("say() cannot inject extra IRC commands", () => {
    const { client, sock } = setup();
    sock.recv(":server 001 Jappe2{ :Welcome");
    client.say("MACHINE[]", "15\r\nJOIN #evil");
    assert.strictEqual(sock.written.at(-1), "PRIVMSG MACHINE[] :15  JOIN #evil");
  });

  it("handles lines split across TCP chunks", () => {
    const { client, sock } = setup();
    sock.emit("data", ":server 00");
    sock.emit("data", "1 Jappe2{ :Welcome\r\n");
    assert.ok(client.registered);
  });
});
