// Feature: repo-cleanup-and-bedrock-sanitization, Property 2: No disallowed control characters remain
// Validates: Requirements 7.1
const test = require("node:test");
const assert = require("node:assert");
const fc = require("fast-check");
const { sanitizeAndCap } = require("../sanitize-recommendations");

// Any disallowed control char: C0 (except \t \n), DEL, C1.
const DISALLOWED = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;

// Generator for a single disallowed control character.
const disallowedControlChar = fc.oneof(
  fc.integer({ min: 0x00, max: 0x08 }),
  fc.constant(0x0b),
  fc.constant(0x0c),
  fc.integer({ min: 0x0e, max: 0x1f }),
  fc.constant(0x7f),
  fc.integer({ min: 0x80, max: 0x9f })
).map((code) => String.fromCharCode(code));

// Retained whitespace that must survive.
const retainedWhitespace = fc.constantFrom("\n", "\t");

test("Property 2: no disallowed control characters remain in the output", () => {
  fc.assert(
    fc.property(
      // Build arrays mixing visible text, disallowed controls, and retained whitespace,
      // then join into a single seeded string.
      fc.array(
        fc.oneof(
          fc.string({ minLength: 1, maxLength: 10 }).filter((s) => !DISALLOWED.test(s)),
          disallowedControlChar,
          retainedWhitespace
        ),
        { minLength: 1, maxLength: 60 }
      ),
      (parts) => {
        const raw = parts.join("");
        const result = sanitizeAndCap(raw);
        assert.ok(!DISALLOWED.test(result), `disallowed control char found in output`);
      }
    ),
    { numRuns: 200 }
  );
});
