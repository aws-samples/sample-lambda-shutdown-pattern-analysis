// Step 1: Extract all shutdown pattern metrics from CloudWatch Insights
const { CloudWatchLogsClient, StartQueryCommand, GetQueryResultsCommand } = require("@aws-sdk/client-cloudwatch-logs");
const { LambdaClient, InvokeCommand } = require("@aws-sdk/client-lambda");

const logsClient = new CloudWatchLogsClient({});
const lambdaClient = new LambdaClient({});
const LOG_GROUP = process.env.LOG_GROUP_NAME || "/metrics/lambda-execution-lifecycle";
const CORRELATION_FUNCTION = process.env.CORRELATION_FUNCTION_NAME || "shutdown-pattern-correlation";

exports.handler = async (event) => {
  const startTime = event.startTime || Math.floor(Date.now() / 1000) - 7200; // default 2 hours ago
  const endTime = event.endTime || Math.floor(Date.now() / 1000);

  console.log(`Extracting metrics from ${new Date(startTime * 1000).toISOString()} to ${new Date(endTime * 1000).toISOString()}`);

  // Run all queries in parallel
  const [
    shutdownSpeed,
    shutdownByReason,
    invokeDistribution,
    trafficPattern,
    memoryPressure,
    durationPattern,
    idleGapPattern,
    provisionedSizing,
    keepAliveData,
    dataQuality,
    correlationResult
  ] = await Promise.all([
    runQuery(QUERIES.shutdownSpeed, startTime, endTime),
    runQuery(QUERIES.shutdownByReason, startTime, endTime),
    runQuery(QUERIES.invokeDistribution, startTime, endTime),
    runQuery(QUERIES.trafficPattern, startTime, endTime),
    runQuery(QUERIES.memoryPressure, startTime, endTime),
    runQuery(QUERIES.durationPattern, startTime, endTime),
    runQuery(QUERIES.idleGapPattern, startTime, endTime),
    runQuery(QUERIES.provisionedSizing, startTime, endTime),
    runQuery(QUERIES.keepAliveData, startTime, endTime),
    runQuery(QUERIES.dataQuality, startTime, endTime),
    invokeCorrelationLambda(startTime, endTime)
  ]);

  const structuredData = {
    analysisWindow: {
      startTime: new Date(startTime * 1000).toISOString(),
      endTime: new Date(endTime * 1000).toISOString(),
      startEpoch: startTime,
      endEpoch: endTime
    },
    shutdownPatterns: {
      bySpeed: formatResults(shutdownSpeed),
      byReason: formatResults(shutdownByReason)
    },
    distributions: {
      byInvokeCount: formatResults(invokeDistribution),
      byTrafficDrop: formatResults(trafficPattern),
      byMemoryPressure: formatResults(memoryPressure),
      byDuration: formatResults(durationPattern),
      byIdleGap: formatResults(idleGapPattern)
    },
    sizing: {
      provisionedConcurrency: formatResults(provisionedSizing),
      keepAlive: formatResults(keepAliveData)
    },
    coldStartCorrelation: correlationResult,
    dataQuality: formatResults(dataQuality)
  };

  console.log("Structured data:", JSON.stringify(structuredData, null, 2));
  return structuredData;
};

function formatResults(rows) {
  if (!rows || rows.length === 0) return [];
  return rows;
}

async function invokeCorrelationLambda(startTime, endTime) {
  try {
    const response = await lambdaClient.send(new InvokeCommand({
      FunctionName: CORRELATION_FUNCTION,
      Payload: JSON.stringify({
        startTime: startTime,
        endTime: endTime
      })
    }));
    return JSON.parse(Buffer.from(response.Payload).toString());
  } catch (err) {
    console.error("Correlation Lambda failed:", err.message);
    return { error: err.message };
  }
}

async function runQuery(query, startTime, endTime) {
  try {
    const { queryId } = await logsClient.send(new StartQueryCommand({
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
      const response = await logsClient.send(new GetQueryResultsCommand({ queryId }));
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
  } catch (err) {
    console.error(`Query failed: ${err.message}`);
    return [];
  }
}

const QUERIES = {
  shutdownSpeed: "filter ispresent(Shutdowns) | fields TotalLifetime / 1000 / 60 as lifetimeMin | fields if(lifetimeMin < 4, 'Fast (<4m)', if(lifetimeMin < 10, 'Medium (4-10m)', 'Slow (>10m)')) as Category | filter ispresent(Category) | stats count(*) as Shutdowns, avg(TotalInvokes) as AvgInvokes, avg(TotalLifetime) / 1000 / 60 as AvgLifetimeMin, avg(AvgIdleGap) / 1000 as AvgIdleGapSec, avg(TrafficDropRate) as AvgTrafficDropPct, avg(AvgMemoryUtilizationPct) as AvgMemUtilPct, avg(AvgBilledDuration) as AvgDurationMs, avg(ShutdownLapse) / 1000 as AvgLapseSec by Category",

  shutdownByReason: "filter ispresent(Shutdowns) | fields @properties.ShutdownReason as shutdownReason | stats count(*) as shutdownCount, avg(TotalLifetime) / 1000 / 60 as avgLifetimeMin, avg(TotalInvokes) as avgInvokes, avg(AvgIdleGap) / 1000 as avgIdleGapSec, avg(TrafficDropRate) as avgTrafficDrop by shutdownReason",

  invokeDistribution: "filter ispresent(Shutdowns) | fields if(TotalInvokes <= 5, '1_very_low', if(TotalInvokes <= 20, '2_low', if(TotalInvokes <= 50, '3_medium', '4_high'))) as invokeCategory | stats count(*) as envCount, avg(TotalInvokes) as avgInvokes, avg(TotalLifetime) / 1000 / 60 as avgLifetimeMin by invokeCategory",

  trafficPattern: "filter ispresent(Shutdowns) | fields if(TrafficDropRate < 25, '1_low', if(TrafficDropRate < 50, '2_moderate', if(TrafficDropRate < 75, '3_high', '4_severe'))) as trafficDropCategory | stats count(*) as envCount, avg(TotalLifetime) / 1000 / 60 as avgLifetimeMin, avg(InvokesLastMinute) as avgLastMinInvokes, avg(PeakRequestsPerMinute) as avgPeakRPM by trafficDropCategory",

  memoryPressure: "filter ispresent(Shutdowns) | fields if(AvgMemoryUtilizationPct < 30, '1_low', if(AvgMemoryUtilizationPct < 60, '2_medium', if(AvgMemoryUtilizationPct < 80, '3_high', '4_critical'))) as memoryCategory | stats count(*) as envCount, avg(TotalLifetime) / 1000 / 60 as avgLifetimeMin, avg(AvgMemoryUtilizationPct) as avgMemUtil, avg(MaxMemoryUtilizationPct) as avgMaxMemUtil by memoryCategory",

  durationPattern: "filter ispresent(Shutdowns) | fields if(AvgBilledDuration < 100, '1_fast', if(AvgBilledDuration < 500, '2_medium', if(AvgBilledDuration < 1000, '3_slow', '4_very_slow'))) as durationCategory | stats count(*) as envCount, avg(TotalLifetime) / 1000 / 60 as avgLifetimeMin, avg(AvgBilledDuration) as avgDurationMs by durationCategory",

  idleGapPattern: "filter ispresent(Shutdowns) | fields if(AvgIdleGap < 5000, '1_tight', if(AvgIdleGap < 30000, '2_moderate', if(AvgIdleGap < 120000, '3_sparse', '4_very_sparse'))) as idleGapCategory | stats count(*) as envCount, avg(TotalLifetime) / 1000 / 60 as avgLifetimeMin, avg(AvgIdleGap) / 1000 as avgIdleGapSec, avg(ShutdownLapse) / 1000 as avgShutdownLapseSec by idleGapCategory",

  provisionedSizing: "filter ispresent(Shutdowns) | stats max(PeakRequestsPerMinute) as overallPeakRPM, avg(PeakRequestsPerMinute) as avgPeakRPM, avg(AvgBilledDuration) as avgDurationMs, avg(InvokeRate) as avgInvokeRate, count(*) as totalEnvironments, avg(AllocatedMemory) as memoryMB",

  keepAliveData: "filter ispresent(Shutdowns) and @properties.ShutdownReason = 'SPINDOWN' | stats count(*) as spindownCount, avg(AvgIdleGap) / 1000 as avgIdleGapSec, percentile(AvgIdleGap / 1000, 50) as p50IdleGapSec, percentile(AvgIdleGap / 1000, 90) as p90IdleGapSec, avg(ShutdownLapse) / 1000 as avgShutdownLapseSec, percentile(ShutdownLapse / 1000, 50) as p50ShutdownLapseSec",

  dataQuality: "filter ispresent(Shutdowns) | stats count(*) as totalEnvironments, sum(MissedReports) as totalMissedReports, avg(MissedReports) as avgMissedPerEnv, sum(ExtensionInvokes) as totalExtensionInvokes, sum(TotalInvokes) as totalTelemetryInvokes"
};
