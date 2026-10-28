// Feature: repo-cleanup-and-bedrock-sanitization, Property 5: Empty or missing input yields the placeholder, real content never does
// Validates: Requirements 7.4
const test = require("node:test");
const assert = require("node:assert");
const fc = require("fast-check");
const { sanitizeAndCap, EMPTY_PLACEHOLDER } = require("../sanitize-recommendations");

// A single disallowed control char.
const disallowedControlChar = fc.oneof(
  fc.integer({ min: 0x00, max: 0x08 }),
  fc.constant(0x0b),
  fc.constant(0x0c),
  fc.integer({ min: 0x0e, max: 0x1f }),
  fc.constant(0x7f),
  fc.integer({ min: 0x80, max: 0x9f })
).map((code) => String.fromCharCode(code));

test("Property 5a: empty/missing/whitespace-only/control-only input yields the placeholder", () => {
  fc.assert(
    fc.property(
      fc.oneof(
        fc.constant(null),
        fc.constant(undefined),
        fc.constant(""),
        fc.integer(),
        fc.boolean(),
        // Whitespace-only (spaces, tabs, newlines).
        fc.array(fc.constantFrom(" ", "\t", "\n", "\r"), { minLength: 1, maxLength: 20 }).map((a) => a.join("")),
        // Control-only inputs (strip to empty).
        fc.array(disallowedControlChar, { minLength: 1, maxLength: 20 }).map((a) => a.join(""))
      ),
      (raw) => {
        assert.strictEqual(sanitizeAndCap(raw), EMPTY_PLACEHOLDER);
      }
    ),
    { numRuns: 200 }
  );
});

test("Property 5b: input that retains visible content never yields the placeholder", () => {
  fc.assert(
    fc.property(
      // Guarantee at least one visible (non-whitespace, non-control) character.
      fc.tuple(
        fc.string(),
        fc.constantFrom("a", "A", "1", "x", "é", "你", "-", "."),
        fc.string()
      ).map(([pre, visible, post]) => pre + visible + post),
      (raw) => {
        assert.notStrictEqual(sanitizeAndCap(raw), EMPTY_PLACEHOLDER);
      }
    ),
    { numRuns: 200 }
  );
});
