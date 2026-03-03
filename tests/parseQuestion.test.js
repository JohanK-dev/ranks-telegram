const { describe, it } = require("node:test");
const assert = require("node:assert");
const parseQuestion = require("../parseQuestion");

function buildMessage(eq1, color1, eq2, color2, eq3, color3) {
  return `\x02# \x02* Please /MSG me the answer of the \x0304RED\x0F\x02 text \x03${color1} ${eq1} \x03${color2} ${eq2} \x03${color3} ${eq3}`;
}

describe("parseQuestion", () => {
  describe("basic parsing", () => {
    it("parses standard message with first equation red", () => {
      const text = buildMessage("6*19", "04", "2*5", "15", "8*7", "15");
      const result = parseQuestion(text);
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.question.equations.length, 3);
      assert.strictEqual(result.question.redEquation.equation, "6*19");
    });

    it("parses standard message with second equation red", () => {
      const text = buildMessage("6*19", "15", "2*5", "04", "8*7", "15");
      const result = parseQuestion(text);
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.question.redEquation.equation, "2*5");
    });

    it("parses standard message with third equation red", () => {
      const text = buildMessage("6*19", "15", "2*5", "15", "8*7", "04");
      const result = parseQuestion(text);
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.question.redEquation.equation, "8*7");
    });
  });

  describe("duplicate equations (original bug)", () => {
    it("two identical equations, first is red", () => {
      const text = buildMessage("0+1", "04", "0+1", "15", "3*7", "15");
      const result = parseQuestion(text);
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.question.redEquation.equation, "0+1");
      const redCount = result.question.equations.filter((e) => e.isRed).length;
      assert.strictEqual(redCount, 1);
    });

    it("two identical equations, second is red", () => {
      const text = buildMessage("0+1", "15", "0+1", "04", "3*7", "15");
      const result = parseQuestion(text);
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.question.redEquation.equation, "0+1");
      const redCount = result.question.equations.filter((e) => e.isRed).length;
      assert.strictEqual(redCount, 1);
    });

    it("three identical equations, middle is red", () => {
      const text = buildMessage("5+5", "15", "5+5", "04", "5+5", "15");
      const result = parseQuestion(text);
      assert.strictEqual(result.success, true);
      const redCount = result.question.equations.filter((e) => e.isRed).length;
      assert.strictEqual(redCount, 1);
      assert.strictEqual(result.question.equations[1].isRed, true);
    });
  });

  describe("all operators", () => {
    it("addition", () => {
      const text = buildMessage("3+4", "04", "1*2", "15", "5-1", "15");
      const result = parseQuestion(text);
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.question.redEquation.equation, "3+4");
    });

    it("subtraction", () => {
      const text = buildMessage("3+4", "15", "10-2", "04", "5*1", "15");
      const result = parseQuestion(text);
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.question.redEquation.equation, "10-2");
    });

    it("multiplication", () => {
      const text = buildMessage("3+4", "15", "1-2", "15", "5*9", "04");
      const result = parseQuestion(text);
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.question.redEquation.equation, "5*9");
    });
  });

  describe("edge cases", () => {
    it("no equations returns failure", () => {
      const text = "\x02# \x02* Please /MSG me the answer of the \x0304RED\x0F\x02 text";
      const result = parseQuestion(text);
      assert.strictEqual(result.success, false);
    });

    it("equations but none red returns failure", () => {
      const text = buildMessage("3+4", "15", "1*2", "15", "5-1", "15");
      const result = parseQuestion(text);
      assert.strictEqual(result.success, false);
    });

    it("multiple red equations returns failure", () => {
      const text = buildMessage("3+4", "04", "1*2", "04", "5-1", "15");
      const result = parseQuestion(text);
      assert.strictEqual(result.success, false);
    });

    it("RED label in prefix does not produce false equation", () => {
      const text = buildMessage("6*19", "15", "2*5", "15", "8*7", "04");
      const result = parseQuestion(text);
      assert.strictEqual(result.question.equations.length, 3);
    });
  });
});