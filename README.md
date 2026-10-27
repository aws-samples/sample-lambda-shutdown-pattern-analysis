# Lambda Execution Environment Shutdown Pattern Analysis

Analyze the lifecycle of AWS Lambda execution environments — cold start, warm, idle, and
shutdown — to make data-driven decisions about reducing cold-start latency and the spend
you make to control it.

A telemetry extension (attached as a Lambda layer, no function code changes) captures
execution-environment lifecycle signals that standard Amazon CloudWatch metrics and Lambda
Insights do **not** expose — idle gaps, shutdown reason and lapse, per-environment
lifetime, and cold-start-to-shutdown churn. The data is written as Embedded Metric Format
(EMF) to a dedicated CloudWatch log group, analyzed with CloudWatch Logs Insights and a
correlation function, and turned into AWS-best-practice optimization guidance by an Amazon
Bedrock pipeline.

> **Latency vs cost:** on on-demand Lambda the init (cold-start) phase is not billed, so
> cold starts are a *latency* concern, not a direct cost. The mitigations (provisioned
> concurrency, keep-alive pings) *do* cost money. This project helps you decide whether —
> and how much — warm capacity is worth it. "Take no action" is a valid outcome.

## What gets deployed

| Component | Purpose |
|-----------|---------|
| Telemetry extension layer | Captures execution-environment lifecycle telemetry as EMF |
| Sample function + Amazon API Gateway | An ordinary `hello-world` function behind `GET /hello` to observe |
| Cold-start correlation function | Correlates shutdowns with following cold starts (environment churn) |
| Recommendation pipeline (AWS Step Functions) | Extract metrics -> generate recommendations (Bedrock) -> update dashboard |
| Two CloudWatch dashboards | Overview (guidance + headline analysis) and Deep Dive (evidence) |

## Prerequisites

- AWS CLI v2, configured with credentials for your account
- AWS SAM CLI
- Node.js 22+ and npm
- Bash (Git Bash on Windows, or native on macOS/Linux) for the load-test script
- Amazon Bedrock model access enabled in your Region for the Claude inference profile you
  pass as `BedrockModelId` (the recommendation pipeline fails without it)

## Deploy

This repository deploys with plain prebuilt artifacts via `template-prebuilt.yaml` (no
`make` required). See **[DEPLOYMENT.md](DEPLOYMENT.md)** for the full step-by-step guide,
and **[TEST_RUNBOOK.md](TEST_RUNBOOK.md)** for an end-to-end deploy-and-test walkthrough.

**Windows one command:**

```cmd
powershell -ExecutionPolicy Bypass -File deploy.ps1
```

`deploy.ps1` builds the extension layer (preserving the Unix executable bit and LF line
endings — a Windows `sam deploy` otherwise strips them and the extension fails to launch),
installs dependencies, runs `sam build`, publishes the layer, and deploys.

**macOS / Linux:**

```bash
cd extension/nodejs-example-telemetry-api-extension && npm install && cd ../..
bash build-layer.sh
(cd insights/recommendation-engine && npm install)
(cd insights/cold-start-correlation && npm install)
sam build -t template-prebuilt.yaml
sam deploy --guided
```

After deployment, note the stack outputs — most importantly `ApiEndpoint`,
`RecommendationPipelineArn`, `DashboardUrl`, and `DeepDiveDashboardUrl`.

## Run the load test

Generate a realistic rise/fall/rise/idle traffic pattern that produces scale-up, idle
periods, shutdowns, and cold starts, then auto-triggers the analysis:

```bash
bash test/hello.sh <ApiEndpoint> <Region> <RecommendationPipelineArn>
```

The run takes about 30 minutes (traffic phases + a 15-minute idle wait + the analysis).
The traffic is generated locally, so keep the machine awake or run it from AWS CloudShell.

## Read the results

Open the `DashboardUrl` (Overview) and `DeepDiveDashboardUrl` (Deep Dive) and set the time
range to cover your run. The Overview's **AI Recommendations** widget is populated by the
Bedrock pipeline and evaluates, in preference order: **SnapStart** (for Java/Python/.NET),
**provisioned concurrency** (sized with Little's Law; the lever for this Node.js sample),
**keep-alive pings** (a caveated stopgap, not recommended as primary), **memory
right-sizing**, and **demand smoothing / scheduled warming** — or recommends no action
when the data does not justify a change.

## Attach the extension to your own function

The reusable takeaway is the extension itself:

1. Attach the `ExtensionLayerArn` (from the stack outputs) to your function's layers — no
   code change required.
2. Set the `METRICS_LOG_GROUP` environment variable to a dedicated log group.
3. Grant the function's role `logs:CreateLogGroup`, `logs:CreateLogStream`,
   `logs:PutLogEvents` on that log group. The extension emits EMF log records only, so no
   CloudWatch metrics permissions are needed.
4. Query and analyze the data with the same Logs Insights queries used here.

Weigh the extension's runtime footprint before leaving it attached to a production
function permanently.

## Repository layout

```
extension/        Telemetry extension layer (the external extension + its Node.js code)
sample-function/  Sample hello-world function the extension observes
insights/         Correlation function, recommendation engine, load-driver, queries
test/             Load-test script
template-prebuilt.yaml   Deploy template (prebuilt artifacts, no make required)
deploy.ps1 / build-layer.* / build-layer-zip.mjs   Build + deploy helpers
```

## Cleanup

```bash
sam delete --stack-name shutdown-pattern-analysis
```

## Security

This is sample code for demonstration and learning, **not production-ready**. The sample
`GET /hello` endpoint is intentionally public and unauthenticated for the demo. See
**[SECURITY.md](SECURITY.md)** for the accepted security trade-offs, the production
hardening steps, and how to report a security issue.

## License

This project is licensed under the MIT-0 License. See the [LICENSE](LICENSE) file.
