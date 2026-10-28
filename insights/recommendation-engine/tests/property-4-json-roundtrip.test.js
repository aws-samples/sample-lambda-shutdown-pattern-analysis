// Feature: repo-cleanup-and-bedrock-sanitization, Property 4: Serialized dashboard body is always valid JSON
// Validates: Requirements 7.2
const test = require("node:test");
const assert = require("node:assert");
const fc = require("fast-check");
const { sanitizeAndCap } = require("../sanitize-recommendations");
const { applyRecommendationsToDashboard, formatRecommendations } = require("../update-dashboard");

// Build a minimal dashboard body containing an "AI Recommendations" text widget.
function buildDashboardBody() {
  return {
    widgets: [
      {
        type: "text",
        x: 0,
        y: 0,
        width: 12,
        height: 10,
        properties: {
          markdown: "## AI Recommendations\n(placeholder)",
          background: "transparent",
        },
      },
    ],
  };
}

test("Property 4: JSON.parse(JSON.stringify(body)) deep-equals body for any input", () => {
  fc.assert(
    fc.property(
      fc.string(),
      fc.record({
        startTime: fc.date().map((d) => d.toISOString()),
        endTime: fc.date().map((d) => d.toISOString()),
      }),
      fc.date().map((d) => d.toISOString()),
      (raw, analysisWindow, generatedAt) => {
        const body = buildDashboardBody();
        const recommendations = sanitizeAndCap(raw);

        // Run the pure transform, wrapping the sanitized text via formatRecommendations
        // (applyRecommendationsToDashboard calls formatRecommendations internally).
        applyRecommendationsToDashboard(body, recommendations, analysisWindow, generatedAt);

        const serialized = JSON.stringify(body);
        const roundTripped = JSON.parse(serialized);
        assert.deepStrictEqual(roundTripped, body);

        // Sanity: the widget markdown matches the wrapper output (confirms real embedding).
        assert.strictEqual(
          body.widgets[0].properties.markdown,
          formatRecommendations(recommendations, analysisWindow, generatedAt)
        );
      }
    ),
    { numRuns: 200 }
  );
});
