#!/usr/bin/env node

// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

const extensionsApi = require("./extensions-api");
const telemetryApi = require("./telemetry-api");
const telemetryListener = require("./telemetry-listener");
const { emitMetrics } = require("./emf-logger");

const NS = "lambda-execution-lifecycle";
const HR = 1; // High resolution storage

var invokes = 0;
var telemetryInvokes = 0;
var extensionId = "";
var initializeTime = Date.now();
var shutdownTime = Date.now();
var firstInvokeTime = Date.now();
var lastInvokeTime = Date.now();
var invokeLapse = 0;
var initDuration = 0;
var initCompletionDate = new Date();
var initStartDate = new Date();
var lastBilledDuration = 0;
let requestMetricsStorage = new Map();
let extensionInvokeLapseStorage = new Map();
var previousRequestId = "";
var totalIdleTime = 0;
var totalBilledDuration = 0;
var requestsPerMinute = new Map();
var allocatedMemory = 0;
var isColdStart = 0;
var initToFirstInvoke = 0;
var shutdownReason = "UNKNOWN";
var memoryConfig = parseInt(process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE || "0", 10);
var maxMemoryUtilizationPct = 0;
var totalMemoryUtilizationPct = 0;

// Helper to build metric entry
function m(value, unit, sr) {
  return { value, unit: unit || "None", storageResolution: sr || HR };
}

(async function main() {
    process.on("SIGINT", () => handleShutdown("SIGINT"));
    process.on("SIGTERM", () => handleShutdown("SIGTERM"));

    extensionId = await extensionsApi.register();
    console.log(`Extension registered. Id: ${extensionId}`);

    const listenerUri = telemetryListener.start();

    await telemetryApi.subscribe(extensionId, listenerUri);

    // Init metric
    await emitMetrics(NS, {
        Environment: m(1, "Count")
    }, {
        ExtensionId: extensionId,
        MemoryConfig: memoryConfig
    }, extensionId);

    while (true) {
        const event = await extensionsApi.next(extensionId);

        switch (event.eventType) {
            case "INVOKE":
                await handleInvoke(event);
                await extractAndPushTelemetryMetrics(telemetryListener.eventsQueue);
                break;
            case "SHUTDOWN":
                shutdownTime = Date.now();
                shutdownReason = event.shutdownReason || "UNKNOWN";
                await new Promise((resolve) => { setTimeout(resolve, 500); });
                if (telemetryListener.eventsQueue.length == 0) {
                    await new Promise((resolve) => { setTimeout(resolve, 500); });
                }
                await extractAndPushTelemetryMetrics(telemetryListener.eventsQueue);
                await pushShutdownMetrics();
                handleShutdown(event);
                process.exit(0);
            default:
                throw new Error("unknown event: " + event);
        }
    }
})();

async function pushShutdownMetrics() {
    const invokesLastMinute = getInvokesInLastMinute();
    const invokesFirstMinute = getInvokesInFirstMinute();
    const peakRPM = getPeakRequestsPerMinute();
    const trafficDropRate = peakRPM > 0
        ? Math.round((peakRPM - invokesLastMinute) / peakRPM * 10000) / 100
        : 0;
    const avgIdleGap = telemetryInvokes > 1 ? Math.round(totalIdleTime / (telemetryInvokes - 1)) : 0;
    const missedReports = invokes - telemetryInvokes;
    const avgMemoryUtilizationPct = telemetryInvokes > 0
        ? Math.round(totalMemoryUtilizationPct / telemetryInvokes * 100) / 100
        : 0;
    const avgBilledDuration = telemetryInvokes > 0 ? Math.round(totalBilledDuration / telemetryInvokes) : 0;
    const lifetimeMinutes = (shutdownTime - initializeTime) / 60000;
    const invokeRate = lifetimeMinutes > 0 ? Math.round((invokes / lifetimeMinutes) * 100) / 100 : 0;

    await emitMetrics(NS, {
        Shutdowns: m(1, "Count"),
        InitDuration: m(initDuration, "Milliseconds"),
        TotalInvokes: m(telemetryInvokes, "Count"),
        ExtensionInvokes: m(invokes, "Count"),
        TotalBilledDuration: m(totalBilledDuration, "Milliseconds"),
        TotalIdleTime: m(totalIdleTime, "Milliseconds"),
        TotalLifetime: m(shutdownTime - firstInvokeTime, "Milliseconds"),
        ShutdownLapse: m(shutdownTime - lastInvokeTime - lastBilledDuration, "Milliseconds"),
        TimeSinceInit: m(shutdownTime - initializeTime, "Milliseconds"),
        InitToFirstInvoke: m(initToFirstInvoke, "Milliseconds"),
        ColdStartOverhead: m(initDuration + initToFirstInvoke, "Milliseconds"),
        InvokesLastMinute: m(invokesLastMinute, "Count"),
        InvokesFirstMinute: m(invokesFirstMinute, "Count"),
        PeakRequestsPerMinute: m(peakRPM, "Count"),
        IsColdStart: m(isColdStart, "Count"),
        AllocatedMemory: m(allocatedMemory, "Megabytes"),
        TrafficDropRate: m(trafficDropRate, "Percent"),
        AvgIdleGap: m(avgIdleGap, "Milliseconds"),
        MissedReports: m(missedReports, "Count"),
        MaxMemoryUtilizationPct: m(maxMemoryUtilizationPct, "Percent"),
        AvgMemoryUtilizationPct: m(avgMemoryUtilizationPct, "Percent"),
        AvgBilledDuration: m(avgBilledDuration, "Milliseconds"),
        InitStartEpoch: m(initializeTime, "Milliseconds"),
        ShutdownEpoch: m(shutdownTime, "Milliseconds"),
        InvokeRate: m(invokeRate, "Count")
    }, {
        ExtensionId: extensionId,
        ExtensionInitializeTime: (new Date(initializeTime)).toISOString(),
        InitStartDate: initStartDate,
        InitCompletionDate: initCompletionDate,
        FirstInvokeTime: (new Date(firstInvokeTime)).toISOString(),
        LastInvokeTime: (new Date(lastInvokeTime)).toISOString(),
        ShutdownTime: (new Date(shutdownTime)).toISOString(),
        ShutdownReason: shutdownReason,
        MemoryConfig: memoryConfig,
        HourOfDay: new Date(shutdownTime).getUTCHours(),
        RequestsPerMinute: JSON.stringify(Object.fromEntries(requestsPerMinute))
    }, extensionId);
}

function handleShutdown(event) {
    if (extensionInvokeLapseStorage.size > 0) {
        for (let key of extensionInvokeLapseStorage.keys()) {
            if (!requestMetricsStorage.has(key)) {
                console.error(`Missing Request Id: ${key}. ExtensionId: ${extensionId}`);
            }
        }
    }
}

async function handleInvoke(event) {
    ++invokes;
    if (invokes > 1) {
        extensionInvokeLapseStorage.set(event.requestId, Math.round(Date.now() - lastInvokeTime));
    } else {
        firstInvokeTime = Date.now();
        if (initCompletionDate) {
            initToFirstInvoke = firstInvokeTime - new Date(initCompletionDate).getTime();
        }
        extensionInvokeLapseStorage.set(event.requestId, 0);
    }
    lastInvokeTime = Date.now();
    const key = getMinuteKey(lastInvokeTime);
    const currentCount = requestsPerMinute.get(key) || 0;
    requestsPerMinute.set(key, currentCount + 1);
}

const getMinuteKey = (date) => {
    return (new Date(date)).toTimeString().substring(0, 5);
};

function getInvokesInLastMinute() {
    if (requestsPerMinute.size === 0) return 0;
    const keys = Array.from(requestsPerMinute.keys());
    return requestsPerMinute.get(keys[keys.length - 1]) || 0;
}

function getInvokesInFirstMinute() {
    if (requestsPerMinute.size === 0) return 0;
    const keys = Array.from(requestsPerMinute.keys());
    return requestsPerMinute.get(keys[0]) || 0;
}

function getPeakRequestsPerMinute() {
    if (requestsPerMinute.size === 0) return 0;
    return Math.max(...requestsPerMinute.values());
}

async function extractAndPushTelemetryMetrics(queue) {
    if (queue.length !== 0) {
        for (const item of queue) {
            if (item.type == "platform.initStart") {
                initStartDate = item.time;
                isColdStart = 1;
            }

            if (item.type == "platform.initReport") {
                initDuration = item.record.metrics.durationMs;
                initCompletionDate = item.time;
            }

            if (item.type == "platform.report") {
                try {
                    requestMetricsStorage.set(item.record.requestId, item.record.metrics.durationMs);
                    totalBilledDuration = totalBilledDuration + item.record.metrics.durationMs;

                    const memoryUsed = item.record.metrics.maxMemoryUsedMB || 0;
                    allocatedMemory = item.record.metrics.memorySizeMB || allocatedMemory;
                    const memoryUtilizationPct = allocatedMemory > 0
                        ? Math.round((memoryUsed / allocatedMemory) * 10000) / 100
                        : 0;

                    if (memoryUtilizationPct > maxMemoryUtilizationPct) {
                        maxMemoryUtilizationPct = memoryUtilizationPct;
                    }
                    totalMemoryUtilizationPct += memoryUtilizationPct;

                    var extensionInvokeLapse = extensionInvokeLapseStorage.get(item.record.requestId);
                    var idleGap = -1;
                    if (extensionInvokeLapse > 0) {
                        var billedDuration = requestMetricsStorage.get(previousRequestId);
                        invokeLapse = extensionInvokeLapse - billedDuration;
                        totalIdleTime = totalIdleTime + invokeLapse;
                        idleGap = invokeLapse;
                    }

                    // Per-invocation metrics
                    const invokeMetrics = {
                        Invokes: m(1, "Count"),
                        BilledDuration: m(item.record.metrics.durationMs, "Milliseconds"),
                        MemoryUsed: m(memoryUsed, "Megabytes"),
                        MemoryUtilizationPct: m(memoryUtilizationPct, "Percent")
                    };
                    if (idleGap >= 0) {
                        invokeMetrics.IdleGap = m(idleGap, "Milliseconds");
                    }

                    await emitMetrics(NS, invokeMetrics, {
                        ExtensionId: extensionId,
                        RequestId: item.record.requestId
                    }, extensionId);

                    telemetryInvokes = telemetryInvokes + 1;
                    previousRequestId = item.record.requestId;
                    lastBilledDuration = item.record.metrics.durationMs;
                } catch (error) {
                    console.error(`Error: ${item.record.requestId} ${error.message}`);
                }
            }
        }
        queue.splice(0);
    }
}
