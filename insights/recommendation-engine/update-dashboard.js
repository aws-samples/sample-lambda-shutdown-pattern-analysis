// Step 3: Update the CloudWatch dashboard with AI recommendations and time range
const { CloudWatchClient, GetDashboardCommand, PutDashboardCommand } = require("@aws-sdk/client-cloudwatch");

const cwClient = new CloudWatchClient({});
const DASHBOARD_NAME = process.env.DASHBOARD_NAME || "Lambda-Shutdown-Pattern-Analysis";

exports.handler = async (event) => {
  const recommendations = event.recommendations;
  const analysisWindow = event.analysisWindow;
  const generatedAt = event.generatedAt;

  // Get current dashboard
  const getDashResponse = await cwClient.send(new GetDashboardCommand({
    DashboardName: DASHBOARD_NAME
  }));

  const dashboardBody = JSON.parse(getDashResponse.DashboardBody);

  // Find and update the text widget with recommendations
  let textWidgetFound = false;
  for (const widget of dashboardBody.widgets) {
    if (widget.type === "text" && widget.properties.markdown.includes("AI Recommendations")) {
      widget.properties.markdown = formatRecommendations(recommendations, analysisWindow, generatedAt);
      textWidgetFound = true;
      break;
    }
  }

  // If no text widget found, add one
  if (!textWidgetFound) {
    dashboardBody.widgets.push({
      type: "text",
      x: 0,
      y: 0,
      width: 12,
      height: 10,
      properties: {
        markdown: formatRecommendations(recommendations, analysisWindow, generatedAt),
        background: "transparent"
      }
    });
  }

  // Set dashboard time range to match analysis window
  dashboardBody.start = analysisWindow.startTime;
  dashboardBody.end = analysisWindow.endTime;

  // Update dashboard
  await cwClient.send(new PutDashboardCommand({
    DashboardName: DASHBOARD_NAME,
    DashboardBody: JSON.stringify(dashboardBody)
  }));

  console.log("Dashboard updated with recommendations");
  return { status: "Dashboard updated", dashboardName: DASHBOARD_NAME };
};

function formatRecommendations(recommendations, analysisWindow, generatedAt) {
  return `## AI Recommendations
**Analysis Window:** ${analysisWindow.startTime} to ${analysisWindow.endTime}
**Generated:** ${generatedAt}

---

${recommendations}

---
*To regenerate for a different time range, invoke the recommendation Step Function with custom startTime/endTime parameters.*`;
}
