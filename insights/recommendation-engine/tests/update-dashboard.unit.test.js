// Edge-case unit tests for the update-dashboard pure transform.
// Validates: Requirements 8.2
const test = require("node:test");
const assert = require("node:assert");
const { sanitizeAndCap } = require("../sanitize-recommendations");
const { applyRecommendationsToDashboard, formatRecommendations } = require("../update-dashboard");

test("fallback branch: with no AI Recommendations widget present, a new text widget is pushed", () => {
  // Dashboard body with only a non-text / unrelated widget (no AI Recommendations widget).
  const body = {
    widgets: [
      { type: "metric", x: 0, y: 0, width: 12, height: 6, properties: { title: "Invocations" } },
    ],
  };
  const widgetCountBefore = body.widgets.length;

  const analysisWindow = { startTime: "2024-01-01T00:00:00.000Z", endTime: "2024-01-02T00:00:00.000Z" };
  const generatedAt = "2024-01-02T01:00:00.000Z";
  const recommendations = sanitizeAndCap("Reduce memory allocation on the hot path.");

  applyRecommendationsToDashboard(body, recommendations, analysisWindow, generatedAt);

  // A new widget was pushed.
  assert.strictEqual(body.widgets.length, widgetCountBefore + 1);

  const pushed = body.widgets[body.widgets.length - 1];
  assert.strictEqual(pushed.type, "text");

  // The pushed widget carries the sanitized output through formatRecommendations.
  const expectedMarkdown = formatRecommendations(recommendations, analysisWindow, generatedAt);
  assert.strictEqual(pushed.properties.markdown, expectedMarkdown);
  assert.ok(pushed.properties.markdown.includes("AI Recommendations"));
  assert.ok(pushed.properties.markdown.includes("Reduce memory allocation on the hot path."));

  // Time range still set.
  assert.strictEqual(body.start, analysisWindow.startTime);
  assert.strictEqual(body.end, analysisWindow.endTime);
});

test("fallback branch: empty/missing recommendations still push a widget carrying the placeholder", () => {
  const body = { widgets: [] };
  const analysisWindow = { startTime: "2024-03-01T00:00:00.000Z", endTime: "2024-03-02T00:00:00.000Z" };
  const generatedAt = "2024-03-02T01:00:00.000Z";
  const recommendations = sanitizeAndCap(undefined);

  applyRecommendationsToDashboard(body, recommendations, analysisWindow, generatedAt);

  assert.strictEqual(body.widgets.length, 1);
  const pushed = body.widgets[0];
  assert.strictEqual(pushed.type, "text");
  assert.ok(pushed.properties.markdown.includes("No recommendations were generated"));
});
