// Step 2: Generate AI recommendations using Amazon Bedrock
const { BedrockRuntimeClient, InvokeModelCommand } = require("@aws-sdk/client-bedrock-runtime");

const bedrockClient = new BedrockRuntimeClient({ region: process.env.AWS_REGION });
const MODEL_ID = process.env.BEDROCK_MODEL_ID || "us.anthropic.claude-sonnet-4-6";

exports.handler = async (event) => {
  const metricsData = event.metricsData;
  const correlationData = event.correlationData;

  const prompt = buildPrompt(metricsData, correlationData);
  console.log("Sending prompt to Bedrock...");

  const response = await bedrockClient.send(new InvokeModelCommand({
    modelId: MODEL_ID,
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify({
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 4096,
      messages: [{
        role: "user",
        content: prompt
      }]
    })
  }));

  const result = JSON.parse(Buffer.from(response.body).toString());
  const recommendations = result.content[0].text;

  console.log("Recommendations generated");
  return {
    recommendations: recommendations,
    analysisWindow: metricsData.analysisWindow,
    generatedAt: new Date().toISOString()
  };
};

function buildPrompt(metricsData, correlationData) {
  return `You are an AWS Lambda performance optimization expert. Analyze the following Lambda execution environment shutdown pattern data and provide actionable, AWS-best-practice recommendations.

## FRAMING: latency vs cost (read first)
Be precise and do NOT conflate latency with cost:
- Cold starts add LATENCY, not direct cost. On on-demand (non-provisioned) Lambda, the INIT phase is not billed, so a cold start is a performance penalty, not a billing line item.
- The MITIGATIONS cost money or add caveats: Provisioned Concurrency is billed for warm capacity whether used or not; keep-alive pings add billable invocations; SnapStart adds a small cache/restore cost but no hourly charge.
- Therefore the goal is a BALANCE: spend only enough to buy the latency you actually need. "Take no action" is a valid and often correct recommendation when cold starts are rare or the workload is not latency-sensitive (e.g. async or batch).

## CRITICAL CONSTRAINTS
All recommendations MUST be practically implementable with real AWS Lambda configurations:
- Memory: only standard values 128, 256, 512, 1024, 1536, 2048, 3072, 4096, 5120, 6144, 7168, 8192, 9216, or 10240 MB
- Timeout: 1 to 900 seconds
- Provisioned Concurrency: integer, minimum 1
- Reserved Concurrency: integer, 0 to account limit
- All values must align with current AWS Lambda service limits
- Do NOT invent values that cannot be set in the AWS Console or CLI

## Data Context
This data was collected by a Lambda telemetry extension that tracks execution-environment lifecycle metrics: cold starts, shutdowns, idle gaps, memory utilization, traffic patterns, billed duration, and a cold-start-to-shutdown churn correlation. The sample workload in this environment is a Node.js function.

## Metrics Data
${JSON.stringify(metricsData, null, 2)}

## Cold Start Correlation Data
${JSON.stringify(correlationData, null, 2)}

## Analysis Required
Produce recommendations in this markdown structure:

### 1. Shutdown Pattern Summary
- Key shutdown patterns; which speed category (Fast/Medium/Slow) dominates and why.
- Note concerning patterns (high churn, excessive fast shutdowns).

### 2. Cold Start Impact Assessment
- Quantify the cold-start LATENCY impact (not cost).
- Calculate the percentage of shutdowns followed by an immediate cold start (churn).
- State plainly whether this workload has a cold-start problem worth solving. If churn is low or cold starts are rare, recommend taking no action and explain why.

### 3. Decision: which strategy (if any)
Walk the decision in this order and recommend accordingly:
1. If there is no meaningful cold-start/latency problem -> recommend NO ACTION.
2. If latency-sensitive AND a real cold-start problem exists, evaluate the strategies below in preference order.

### 4. Recommended Actions
For each strategy you recommend, give: **Action**, **Rationale** (tied to specific metrics), **Expected Impact** (quantified), and **Cost** (dollar cost for mitigations, or "latency only").

Evaluate these strategies IN THIS PREFERENCE ORDER:

#### a) SnapStart (prefer first, where supported)
- SnapStart is the AWS-preferred cold-start mitigation for Java, Python, and .NET. It has no hourly charge.
- IMPORTANT: SnapStart is NOT available for Node.js or Go. The workload here is Node.js, so SnapStart does NOT apply to it — say so explicitly, and note that for a Java/Python/.NET workload it would be the first thing to try before Provisioned Concurrency.
- Note SnapStart caveats: restore-time uniqueness/state handling.

#### b) Provisioned Concurrency (when SnapStart does not apply, or for strict latency SLOs)
- This is the realistic lever for the Node.js sample.
- Size with Little's Law: concurrent_envs = (peak_RPM / 60) * avg_duration_sec. Recommend a specific integer.
- Weigh the monthly cost of that warm capacity against the cold-start latency currently paid.
- For predictable peaks, recommend SCHEDULED scaling of Provisioned Concurrency rather than a flat 24/7 figure.

#### c) Keep-alive pings (NOT recommended as a primary strategy — mention only with caveats)
- Treat keep-alive as a crude, low-cost stopgap, not a co-equal strategy. Do NOT lead with it.
- State the caveats plainly: a ping keeps only ONE environment warm; pings do not survive scale-up; the platform can still recycle environments (TIMEOUT, platform updates). It is not an AWS-recommended pattern.
- If the data makes keep-alive tempting (e.g. tight, consistent idle gaps), still steer toward Provisioned Concurrency (or SnapStart for supported runtimes) as the supported answer.

#### d) Memory right-sizing
- Based on memory utilization, recommend raising/lowering memory, choosing only from the standard values above.
- Note that memory scales CPU proportionally, and that under-provisioned memory can correlate with faster shutdowns.

#### e) Demand smoothing / scheduled warming (architecture lever, not a function setting)
- This is NOT traffic the function controls; it is an upstream/architecture choice the owner makes.
- If traffic drops are predictable (time-of-day), recommend scheduled scaling of Provisioned Concurrency, or buffering spiky arrivals with SQS/Kinesis, or caching (API Gateway/CloudFront) to cut invocation spikes.
- If traffic is unpredictable, say this lever does not help and point back to warming strategies.

### 5. Cost-Benefit Summary Table
| Strategy | Monthly Cost | Cold Starts Prevented | Latency Improvement | Recommendation |
|----------|-------------|----------------------|--------------------:|----------------|
(Use "latency only" in the cost column for cold starts themselves; dollar costs apply to the mitigations.)

### 6. Priority Actions
Top 3 actions in priority order by impact-to-cost ratio. If the best action is "do nothing," say so as #1.

Be specific with numbers from the actual data. Every recommendation must reference specific metrics. Prefer SnapStart (supported runtimes) and Provisioned Concurrency over keep-alive, and always allow "no action" as a legitimate outcome.`;
}
