// Feature: repo-cleanup-and-bedrock-sanitization, Property 1: Output length is bounded and over-length input is truncated with the indicator
// Validates: Requirements 6.1, 6.2, 6.3, 7.3
const test = require("node:test");
const assert = require("node:assert");
const fc = require("fast-check");
const {
  sanitizeAndCap,
  stripControlChars,
  MAX_RECOMMENDATION_CHARS,
  TRUNCATION_INDICATOR,
  EMPTY_PLACEHOLDER,
} = require("../sanitize-recommendations");

test("Property 1: output length bounded; over-length truncated with indicator; within-limit unchanged by cap", () => {
  fc.assert(
    fc.property(
      // Mix of short strings and strings far longer than the cap.
      fc.oneof(
        fc.string(),
        fc.string({ minLength: MAX_RECOMMENDATION_CHARS + 1, maxLength: MAX_RECOMMENDATION_CHARS + 5000 }),
        fc.string({ minLength: 0, maxLength: 200 }),
      ),
      (raw) => {
        const result = sanitizeAndCap(raw);
        const sanitized = stripControlChars(raw);

        // Result length is always bounded.
        assert.ok(result.length <= MAX_RECOMMENDATION_CHARS + TRUNCATION_INDICATOR.length);

        // Placeholder branch is exempt from the length-vs-sanitized assertions.
        if (result === EMPTY_PLACEHOLDER) {
          return;
        }

        if (sanitized.length > MAX_RECOMMENDATION_CHARS) {
          // Over-length: ends with the full indicator and the body is the capped slice.
          assert.ok(result.endsWith(TRUNCATION_INDICATOR));
          assert.strictEqual(
            result,
            sanitized.slice(0, MAX_RECOMMENDATION_CHARS) + TRUNCATION_INDICATOR
          );
        } else {
          // At or below the cap: the cap stage leaves the sanitized text unchanged.
          assert.strictEqual(result, sanitized);
        }
      }
    ),
    { numRuns: 200 }
  );
});
