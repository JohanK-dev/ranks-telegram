const { describe, it } = require("node:test");
const assert = require("node:assert");
const { normalizeAnswer } = require("../answer");

describe("normalizeAnswer", () => {
  it("applies the multiplication shortcut", () => {
    assert.strictEqual(normalizeAnswer("9 8"), "72");
  });

  it("trims plain answers", () => {
    assert.strictEqual(normalizeAnswer(" 42 "), "42");
  });

  it("passes through non-numeric pairs", () => {
    assert.strictEqual(normalizeAnswer("hello there"), "hello there");
  });
});
