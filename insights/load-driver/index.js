// Server-side load driver for the Lambda Shutdown Pattern Analysis workshop.
//
// One invocation sends a single "burst" of concurrent requests to the sample
// function's public API endpoint. The Step Functions load-test pipeline calls
// this repeatedly to shape the traffic phases (high / reduced / high / idle),
// so participants never need a local script or shell.
//
// Event shape:
//   {
//     "apiUrl":   "https://xxxx.execute-api.us-east-1.amazonaws.com/Stage/hello",
//     "count":    40,     // total requests in this burst
//     "parallel": 20      // max concurrent requests
//   }
// apiUrl falls back to the API_URL environment variable when omitted.

const DEFAULT_COUNT = 20;
const DEFAULT_PARALLEL = 10;
const REQUEST_TIMEOUT_MS = 10000;

async function sendOne(apiUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(apiUrl, { method: 'GET', signal: controller.signal });
    // Drain the body so the connection completes cleanly.
    await res.text().catch(() => {});
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// Run `count` requests with at most `parallel` in flight at once.
async function runBurst(apiUrl, count, parallel) {
  let index = 0;
  let ok = 0;
  let failed = 0;

  async function worker() {
    while (index < count) {
      const myIndex = index++;
      if (myIndex >= count) break;
      const success = await sendOne(apiUrl);
      if (success) ok++;
      else failed++;
    }
  }

  const workers = [];
  const lanes = Math.max(1, Math.min(parallel, count));
  for (let i = 0; i < lanes; i++) workers.push(worker());
  await Promise.all(workers);
  return { ok, failed };
}

exports.handler = async (event = {}) => {
  const apiUrl = event.apiUrl || process.env.API_URL;
  if (!apiUrl) {
    throw new Error('apiUrl is required (event.apiUrl or API_URL env var)');
  }
  const count = Number(event.count) > 0 ? Number(event.count) : DEFAULT_COUNT;
  const parallel = Number(event.parallel) > 0 ? Number(event.parallel) : DEFAULT_PARALLEL;

  const started = Date.now();
  const { ok, failed } = await runBurst(apiUrl, count, parallel);
  const durationMs = Date.now() - started;

  console.log(
    `burst complete: requested=${count} ok=${ok} failed=${failed} durationMs=${durationMs}`
  );
  // epochSeconds lets the load-test state machine record the analysis window
  // (Logs Insights and the recommendation pipeline expect epoch seconds).
  return {
    requested: count,
    ok,
    failed,
    durationMs,
    epochSeconds: Math.floor(Date.now() / 1000),
  };
};
