// Edge-case unit tests for the sanitize-and-cap helper (Task 7.6).
// Requirements: 6.1, 6.2, 6.3, 7.1, 7.4
const test = require("node:test");
const assert = require("node:assert");
const {
  sanitizeAndCap,
  MAX_RECOMMENDATION_CHARS,
  TRUNCATION_INDICATOR,
  EMPTY_PLACEHOLDER,
} = require("../sanitize-recommendations");

test("within-limit recommendation passes through unchanged by the cap (R6.3)", () => {
  const input = "## Findings\n- Cold starts correlate with shutdown bursts.\n- Consider provisioned concurrency.";
  assert.strictEqual(sanitizeAndCap(input), input);
});

test("exactly-at-cap input is not truncated (R6.1/R6.2 boundary)", () => {
  const input = "a".repeat(MAX_RECOMMENDATION_CHARS);
  const result = sanitizeAndCap(input);
  assert.strictEqual(result, input);
  assert.strictEqual(result.length, MAX_RECOMMENDATION_CHARS);
  assert.ok(!result.endsWith(TRUNCATION_INDICATOR));
});

test("one char over the cap is truncated and ends with the indicator (R6.1/R6.2 boundary)", () => {
  const input = "a".repeat(MAX_RECOMMENDATION_CHARS + 1);
  const result = sanitizeAndCap(input);
  assert.ok(result.endsWith(TRUNCATION_INDICATOR));
  assert.strictEqual(
    result,
    "a".repeat(MAX_RECOMMENDATION_CHARS) + TRUNCATION_INDICATOR
  );
  assert.strictEqual(result.length, MAX_RECOMMENDATION_CHARS + TRUNCATION_INDICATOR.length);
});

test("null returns the placeholder (R7.4)", () => {
  assert.strictEqual(sanitizeAndCap(null), EMPTY_PLACEHOLDER);
});

test("undefined returns the placeholder (R7.4)", () => {
  assert.strictEqual(sanitizeAndCap(undefined), EMPTY_PLACEHOLDER);
});

test("empty string returns the placeholder (R7.4)", () => {
  assert.strictEqual(sanitizeAndCap(""), EMPTY_PLACEHOLDER);
});

test("NUL and DEL are removed while surrounding text and embedded \\n survive (R7.1)", () => {
  const input = "before\u0000middle\u007fafter\nnext line";
  const result = sanitizeAndCap(input);
  assert.strictEqual(result, "beforemiddleafter\nnext line");
  assert.ok(!result.includes("\u0000"));
  assert.ok(!result.includes("\u007f"));
  assert.ok(result.includes("\n"));
});

test("idempotence holds for over-length input (R6.3/R7.1)", () => {
  const input = "x".repeat(MAX_RECOMMENDATION_CHARS + 500);
  const once = sanitizeAndCap(input);
  const twice = sanitizeAndCap(once);
  assert.strictEqual(twice, once);
});
