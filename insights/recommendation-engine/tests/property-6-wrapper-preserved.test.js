// Feature: repo-cleanup-and-bedrock-sanitization, Property 6: The formatRecommendations wrapper is preserved
// Validates: Requirements 7.5
const test = require("node:test");
const assert = require("node:assert");
const fc = require("fast-check");
const { sanitizeAndCap } = require("../sanitize-recommendations");
const { formatRecommendations } = require("../update-dashboard");

test("Property 6: formatRecommendations always preserves heading, window line, generated-at line, and regeneration note", () => {
  fc.assert(
    fc.property(
      // Generate sanitizeAndCap outputs from arbitrary raw input.
      fc.string().map((raw) => sanitizeAndCap(raw)),
      // Analysis windows with both start and end times.
      fc.record({
        startTime: fc.date().map((d) => d.toISOString()),
        endTime: fc.date().map((d) => d.toISOString()),
      }),
      // Generated-at timestamps.
      fc.date().map((d) => d.toISOString()),
      (recommendations, analysisWindow, generatedAt) => {
        const out = formatRecommendations(recommendations, analysisWindow, generatedAt);

        // "AI Recommendations" heading.
        assert.ok(out.includes("## AI Recommendations"));

        // Analysis-window line with BOTH start and end times.
        assert.ok(
          out.includes(
            `**Analysis Window:** ${analysisWindow.startTime} to ${analysisWindow.endTime}`
          )
        );
        assert.ok(out.includes(analysisWindow.startTime));
        assert.ok(out.includes(analysisWindow.endTime));

        // Generated-at line.
        assert.ok(out.includes(`**Generated:** ${generatedAt}`));

        // Regeneration note.
        assert.ok(
          out.includes(
            "*To regenerate for a different time range, invoke the recommendation Step Function with custom startTime/endTime parameters.*"
          )
        );
      }
    ),
    { numRuns: 200 }
  );
});
