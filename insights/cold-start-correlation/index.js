const { CloudWatchLogsClient, StartQueryCommand, GetQueryResultsCommand } = require("@aws-sdk/client-cloudwatch-logs");
const { metricScope, Unit, StorageResolution, Configuration } = require("aws-embedded-metrics");

const client = new CloudWatchLogsClient({});
const LOG_GROUP = process.env.LOG_GROUP_NAME;
const CORRELATION_WINDOW_MS = parseInt(process.env.CORRELATION_WINDOW_MS || "30000", 10);
const LOOKBACK_HOURS = parseInt(process.env.LOOKBACK_HOURS || "24", 10);

// Direct EMF output to the same dedicated metrics log group
Configuration.logGroupName = LOG_GROUP;

exports.handler = async (event = {}) => {
  // Honor an explicit analysis window (epoch seconds) when the caller provides
  // one — the recommendation pipeline passes the exact load-test window via
  // { startTime, endTime }. Fall back to the LOOKBACK_HOURS env var for the
  // scheduled, event-less invocation.
  const endTime = Number(event.endTime) > 0
    ? Math.floor(Number(event.endTime))
    : Math.floor(Date.now() / 1000);
  const startTime = Number(event.startTime) > 0
    ? Math.floor(Number(event.startTime))
    : endTime - (LOOKBACK_HOURS * 3600);

  // Run both queries in parallel
  const [shutdowns, coldStarts] = await Promise.all([
    runInsightsQuery(
      "filter Shutdowns = 1 | fields ShutdownEpoch, @properties.ExtensionId as envId, TotalLifetime, TotalInvokes, ShutdownLapse, @properties.ShutdownReason as reason, AvgIdleGap, TrafficDropRate | sort ShutdownEpoch asc",
      startTime, endTime
    ),
    runInsightsQuery(
      "filter Environment = 1 | fields InitStartEpoch, @properties.ExtensionId as envId, @properties.MemoryConfig as memoryMB | sort InitStartEpoch asc",
      startTime, endTime
    )
  ]);

  // Correlate: for each shutdown, find cold starts within the window
  const correlations = [];
  let coldStartIdx = 0;

  for (const shutdown of shutdowns) {
    const shutdownEpoch = parseFloat(shutdown.ShutdownEpoch);
    const windowEnd = shutdownEpoch + CORRELATION_WINDOW_MS;

    // Advance cold start pointer to the window start
    while (coldStartIdx < coldStarts.length &&
           parseFloat(coldStarts[coldStartIdx].InitStartEpoch) < shutdownEpoch) {
      coldStartIdx++;
    }

    // Collect cold starts within the window
    let tempIdx = coldStartIdx;
    while (tempIdx < coldStarts.length &&
           parseFloat(coldStarts[tempIdx].InitStartEpoch) <= windowEnd) {
      const coldStart = coldStarts[tempIdx];

      if (coldStart.envId !== shutdown.envId) {
        correlations.push({
          shutdownEnvId: shutdown.envId,
          coldStartEnvId: coldStart.envId,
          shutdownEpoch: shutdownEpoch,
          coldStartEpoch: parseFloat(coldStart.InitStartEpoch),
          gapMs: parseFloat(coldStart.InitStartEpoch) - shutdownEpoch,
          shutdownReason: shutdown.reason,
          shutdownLifetimeMs: parseFloat(shutdown.TotalLifetime),
          shutdownInvokes: parseInt(shutdown.TotalInvokes),
          shutdownLapseMs: parseFloat(shutdown.ShutdownLapse),
          avgIdleGapMs: parseFloat(shutdown.AvgIdleGap),
          trafficDropRate: parseFloat(shutdown.TrafficDropRate),
          memoryMB: parseInt(coldStart.memoryMB || "0")
        });
      }
      tempIdx++;
    }
  }

  // Build summary
  const summary = {
    analysisWindow: {
      startTime: new Date(startTime * 1000).toISOString(),
      endTime: new Date(endTime * 1000).toISOString(),
      correlationWindowMs: CORRELATION_WINDOW_MS
    },
    totalShutdowns: shutdowns.length,
    totalColdStarts: coldStarts.length,
    coldStartsNearShutdown: correlations.length,
    churnRate: shutdowns.length > 0
      ? Math.round((correlations.length / shutdowns.length) * 10000) / 100
      : 0,
    avgGapMs: correlations.length > 0
      ? Math.round(correlations.reduce((sum, c) => sum + c.gapMs, 0) / correlations.length)
      : 0,
    byShutdownReason: groupBy(correlations, "shutdownReason"),
    gapDistribution: {
      within5s: correlations.filter(c => c.gapMs < 5000).length,
      within10s: correlations.filter(c => c.gapMs >= 5000 && c.gapMs < 10000).length,
      within20s: correlations.filter(c => c.gapMs >= 10000 && c.gapMs < 20000).length,
      within30s: correlations.filter(c => c.gapMs >= 20000).length
    },
    churningEnvironments: {
      avgLifetimeMs: avg(correlations, "shutdownLifetimeMs"),
      avgInvokes: avg(correlations, "shutdownInvokes"),
      avgShutdownLapseMs: avg(correlations, "shutdownLapseMs"),
      avgIdleGapMs: avg(correlations, "avgIdleGapMs"),
      avgTrafficDropRate: avg(correlations, "trafficDropRate")
    }
  };

  await pushCorrelationMetrics(summary);
  return summary;
};


function groupBy(items, key) {
  const groups = {};
  for (const item of items) {
    const val = item[key] || "UNKNOWN";
    if (!groups[val]) groups[val] = { count: 0, totalGap: 0 };
    groups[val].count++;
    groups[val].totalGap += item.gapMs;
  }
  for (const val of Object.keys(groups)) {
    groups[val].avgGapMs = Math.round(groups[val].totalGap / groups[val].count);
    delete groups[val].totalGap;
  }
  return groups;
}

function avg(items, key) {
  if (items.length === 0) return 0;
  return Math.round(items.reduce((sum, i) => sum + (i[key] || 0), 0) / items.length);
}

const pushCorrelationMetrics = metricScope(metrics =>
async (summary) => {
  metrics.putMetric("ColdStartsNearShutdown", summary.coldStartsNearShutdown, Unit.Count, StorageResolution.High);
  metrics.putMetric("ChurnRate", summary.churnRate, Unit.Percent, StorageResolution.High);
  metrics.putMetric("AvgChurnGap", summary.avgGapMs, Unit.Milliseconds, StorageResolution.High);
  metrics.putMetric("TotalShutdowns", summary.totalShutdowns, Unit.Count, StorageResolution.High);
  metrics.putMetric("TotalColdStarts", summary.totalColdStarts, Unit.Count, StorageResolution.High);
  metrics.setProperty("CorrelationWindowMs", summary.analysisWindow.correlationWindowMs);
  metrics.setProperty("GapDistribution", JSON.stringify(summary.gapDistribution));
  metrics.setProperty("ByShutdownReason", JSON.stringify(summary.byShutdownReason));
  metrics.setNamespace("lambda-execution-lifecycle");
});

async function runInsightsQuery(query, startTime, endTime) {
  const { queryId } = await client.send(new StartQueryCommand({
    logGroupNames: [LOG_GROUP],
    startTime,
    endTime,
    queryString: query,
    limit: 10000
  }));

  let status = "Running";
  let results = [];
  while (status === "Running" || status === "Scheduled") {
    await new Promise(resolve => setTimeout(resolve, 1000));
    const response = await client.send(new GetQueryResultsCommand({ queryId }));
    status = response.status;
    if (status === "Complete") {
      results = response.results.map(row => {
        const obj = {};
        for (const field of row) {
          obj[field.field] = field.value;
        }
        return obj;
      });
    }
  }
  return results;
}
