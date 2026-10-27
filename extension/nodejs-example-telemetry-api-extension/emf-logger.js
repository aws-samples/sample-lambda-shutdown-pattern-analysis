// Direct EMF logger that writes to a dedicated CloudWatch Logs log group
// via the PutLogEvents API, bypassing stdout.

const https = require("https");
const http = require("http");

const LOG_GROUP = process.env.METRICS_LOG_GROUP || "/metrics/lambda-execution-lifecycle";
const REGION = process.env.AWS_REGION || "us-east-1";
const LOG_STREAM_PREFIX = "ext-";

let logStreamName = null;
let sequenceToken = null;
let logsClient = null;

async function getLogsClient() {
  if (logsClient) return logsClient;
  const { CloudWatchLogsClient, CreateLogStreamCommand, PutLogEventsCommand } = require("@aws-sdk/client-cloudwatch-logs");
  logsClient = new CloudWatchLogsClient({ region: REGION });
  return logsClient;
}

async function ensureLogStream(extensionId) {
  if (logStreamName) return;
  const { CreateLogStreamCommand } = require("@aws-sdk/client-cloudwatch-logs");
  logStreamName = `${LOG_STREAM_PREFIX}${extensionId}-${Date.now()}`;
  const client = await getLogsClient();
  try {
    await client.send(new CreateLogStreamCommand({
      logGroupName: LOG_GROUP,
      logStreamName: logStreamName
    }));
  } catch (err) {
    if (err.name !== "ResourceAlreadyExistsException") {
      console.error("Failed to create log stream:", err.message);
    }
  }
}

// Build an EMF-formatted JSON string
function buildEmfRecord(namespace, metrics, properties) {
  const metricDefinitions = [];
  const metricValues = {};

  for (const [name, { value, unit, storageResolution }] of Object.entries(metrics)) {
    metricDefinitions.push({
      Name: name,
      Unit: unit || "None",
      StorageResolution: storageResolution || 1
    });
    metricValues[name] = value;
  }

  const record = {
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: [{
        Namespace: namespace,
        Dimensions: [[]],
        Metrics: metricDefinitions
      }]
    },
    ...metricValues,
    ...properties
  };

  return JSON.stringify(record);
}

// Write an EMF record to the dedicated log group
async function putEmfRecord(emfJson) {
  const { PutLogEventsCommand } = require("@aws-sdk/client-cloudwatch-logs");
  const client = await getLogsClient();

  const params = {
    logGroupName: LOG_GROUP,
    logStreamName: logStreamName,
    logEvents: [{
      timestamp: Date.now(),
      message: emfJson
    }]
  };

  if (sequenceToken) {
    params.sequenceToken = sequenceToken;
  }

  try {
    const result = await client.send(new PutLogEventsCommand(params));
    sequenceToken = result.nextSequenceToken;
  } catch (err) {
    if (err.name === "InvalidSequenceTokenException") {
      sequenceToken = err.expectedSequenceToken;
      params.sequenceToken = sequenceToken;
      const result = await client.send(new PutLogEventsCommand(params));
      sequenceToken = result.nextSequenceToken;
    } else {
      console.error("Failed to put EMF record:", err.message);
    }
  }
}

// High-level: build and write an EMF record
// Writes to dedicated log group only (for Insights queries, low scan cost)
async function emitMetrics(namespace, metrics, properties, extensionId) {
  await ensureLogStream(extensionId);
  const emfJson = buildEmfRecord(namespace, metrics, properties);
  await putEmfRecord(emfJson);
}

module.exports = { emitMetrics };
