// Feature: repo-cleanup-and-bedrock-sanitization, Property 3: Sanitization and capping are idempotent
// Validates: Requirements 7.1, 6.3
const test = require("node:test");
const assert = require("node:assert");
const fc = require("fast-check");
const { sanitizeAndCap, MAX_RECOMMENDATION_CHARS } = require("../sanitize-recommendations");

// A single disallowed control char, to make sure controls do not break idempotence.
const disallowedControlChar = fc.oneof(
  fc.integer({ min: 0x00, max: 0x08 }),
  fc.constant(0x0b),
  fc.constant(0x0c),
  fc.integer({ min: 0x0e, max: 0x1f }),
  fc.constant(0x7f),
  fc.integer({ min: 0x80, max: 0x9f })
).map((code) => String.fromCharCode(code));

test("Property 3: sanitizeAndCap(sanitizeAndCap(x)) === sanitizeAndCap(x)", () => {
  fc.assert(
    fc.property(
      fc.oneof(
        fc.string(),
        // Over-length inputs to exercise the truncation branch under idempotence.
        fc.string({ minLength: MAX_RECOMMENDATION_CHARS + 1, maxLength: MAX_RECOMMENDATION_CHARS + 3000 }),
        // Strings seeded with control characters.
        fc.array(fc.oneof(fc.string({ maxLength: 5 }), disallowedControlChar, fc.constantFrom("\n", "\t")), { maxLength: 50 })
          .map((parts) => parts.join("")),
        // Non-string inputs.
        fc.constant(null),
        fc.constant(undefined),
        fc.integer()
      ),
      (raw) => {
        const once = sanitizeAndCap(raw);
        const twice = sanitizeAndCap(once);
        assert.strictEqual(twice, once);
      }
    ),
    { numRuns: 200 }
  );
});
