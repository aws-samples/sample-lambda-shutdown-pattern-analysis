// Caps and sanitizes raw Amazon Bedrock recommendation text before it is
// embedded into the CloudWatch dashboard text widget. Pure functions only
// (no AWS clients, no side effects) so the logic is unit- and property-testable.

const MAX_RECOMMENDATION_CHARS = 20000;
const TRUNCATION_INDICATOR = "\n\n*(recommendations truncated)*";
const EMPTY_PLACEHOLDER = "*No recommendations were generated for this analysis window.*";

// Disallowed control characters:
//   - C0 controls U+0000–U+001F EXCEPT \t (U+0009) and \n (U+000A)
//   - DEL U+007F
//   - C1 controls U+0080–U+009F
// Matches U+000B, U+000C, U+000E–U+001F, U+0000–U+0008, plus DEL and C1.
const DISALLOWED_CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

/**
 * Remove control characters that are not normal whitespace.
 * Keeps \n (U+000A) and \t (U+0009); strips other C0 controls, the DEL
 * character (U+007F), and C1 controls (U+0080–U+009F) so the text cannot
 * carry structure-breaking control bytes into the dashboard body.
 * @param {string} text
 * @returns {string}
 */
function stripControlChars(text) {
  return text.replace(DISALLOWED_CONTROL_CHARS, "");
}

/**
 * Sanitize then cap. Empty/missing input yields the placeholder.
 * Sanitization runs first; the truncation indicator is appended after the
 * cap so it always survives in the returned string.
 * @param {unknown} raw  raw model text (event.recommendations)
 * @returns {string} safe, bounded text ready for formatRecommendations
 */
function sanitizeAndCap(raw) {
  // 1. Normalize input: null/undefined/non-string -> placeholder.
  if (typeof raw !== "string") {
    return EMPTY_PLACEHOLDER;
  }

  // 2. Sanitize first.
  const sanitized = stripControlChars(raw);

  // 3. Empty or whitespace-only after sanitization -> placeholder.
  if (sanitized.trim().length === 0) {
    return EMPTY_PLACEHOLDER;
  }

  // 4. Cap on the sanitized text length. The indicator is appended AFTER the
  //    cap so it always survives. Re-applying sanitizeAndCap is stable: a
  //    second pass sanitizes the already-capped text (which contains no
  //    disallowed controls, so it is unchanged) and the length check is still
  //    evaluated on that sanitized text. When the first pass truncated, the
  //    second pass sees `<capped MAX chars> + TRUNCATION_INDICATOR`. The slice
  //    takes the first MAX chars (the already-capped body, unchanged) and
  //    re-appends the same indicator, yielding an identical string.
  if (sanitized.length > MAX_RECOMMENDATION_CHARS) {
    return sanitized.slice(0, MAX_RECOMMENDATION_CHARS) + TRUNCATION_INDICATOR;
  }

  // 5. At or below the cap: unchanged by the cap stage.
  return sanitized;
}

module.exports = {
  sanitizeAndCap,
  stripControlChars,
  MAX_RECOMMENDATION_CHARS,
  TRUNCATION_INDICATOR,
  EMPTY_PLACEHOLDER,
};
