// Feature: repo-cleanup-and-bedrock-sanitization, Property 7: Within-limit input updates the AI Recommendations widget and sets the time range
// Validates: Requirements 8.2
const test = require("node:test");
const assert = require("node:assert");
const fc = require("fast-check");
const {
  sanitizeAndCap,
  MAX_RECOMMENDATION_CHARS,
} = require("../sanitize-recommendations");
const { applyRecommendationsToDashboard, formatRecommendations } = require("../update-dashboard");

// Generator for an in-memory dashboard body that contains a text widget whose
// markdown includes "AI Recommendations", optionally surrounded by other widgets.
const dashboardBodyArb = fc
  .record({
    before: fc.array(
      fc.record({
        type: fc.constant("metric"),
        properties: fc.record({ title: fc.string() }),
      }),
      { maxLength: 3 }
    ),
    heading: fc.string().map((s) => `## AI Recommendations\n${s}`),
    after: fc.array(
      fc.record({
        type: fc.constant("metric"),
        properties: fc.record({ title: fc.string() }),
      }),
      { maxLength: 3 }
    ),
  })
  .map(({ before, heading, after }) => {
    const widgets = [
      ...before,
      { type: "text", x: 0, y: 0, width: 12, height: 10, properties: { markdown: heading, background: "transparent" } },
      ...after,
    ];
    return { widgets };
  });

test("Property 7: within-limit input updates the AI Recommendations widget markdown and sets start/end", () => {
  fc.assert(
    fc.property(
      dashboardBodyArb,
      // Within-limit recommendation inputs (well under MAX chars).
      fc.string({ maxLength: Math.min(2000, MAX_RECOMMENDATION_CHARS) }),
      fc.record({
        startTime: fc.date().map((d) => d.toISOString()),
        endTime: fc.date().map((d) => d.toISOString()),
      }),
      fc.date().map((d) => d.toISOString()),
      (body, raw, analysisWindow, generatedAt) => {
        const recommendations = sanitizeAndCap(raw);

        applyRecommendationsToDashboard(body, recommendations, analysisWindow, generatedAt);

        // Locate the "AI Recommendations" text widget that was updated.
        const widget = body.widgets.find(
          (w) => w.type === "text" && w.properties.markdown.includes("AI Recommendations")
        );
        assert.ok(widget, "an AI Recommendations text widget should exist");

        // Its markdown equals the formatRecommendations output.
        assert.strictEqual(
          widget.properties.markdown,
          formatRecommendations(recommendations, analysisWindow, generatedAt)
        );

        // Time range set from the analysis window.
        assert.strictEqual(body.start, analysisWindow.startTime);
        assert.strictEqual(body.end, analysisWindow.endTime);
      }
    ),
    { numRuns: 200 }
  );
});
