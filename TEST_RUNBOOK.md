# Deploy & Test Runbook (AWS SAM)

Deploy and test this project (`template-prebuilt.yaml`) into an AWS account using the
AWS SAM CLI. All commands run from this project directory unless noted.

Tools required (install once): AWS CLI v2, Node.js 22+, npm, AWS SAM CLI. Make sure your
AWS credentials are active (`aws sts get-caller-identity` returns your account), and that
Amazon Bedrock model access is enabled in your Region for the `BedrockModelId`.

---

## The one command (recommended, Windows)

`deploy.ps1` runs the whole build + deploy end to end and prints a SUCCESS/FAIL verdict.
From **Windows Command Prompt**, in this project folder:

```cmd
powershell -ExecutionPolicy Bypass -File deploy.ps1
```

Useful switches:
- `-DeleteFirst`  — `sam delete` the stack first, then deploy from a clean slate.
- `-DeleteOnly`   — just tear the stack down and exit.
- `-Guided`       — force the guided `sam deploy` prompts.
- `-SkipDeploy`   — build the artifacts only, no deploy.
- `-Region`, `-StackName`, `-BedrockModelId` — override the defaults.

What it runs, in order: install extension deps -> assemble the layer dir (build-layer.ps1)
-> package the layer zip with the Unix executable bit and LF line endings
(build-layer-zip.mjs) -> install the two insights Lambda deps -> `sam build` -> publish
the extension layer with the AWS CLI (so the executable bit and LF shebang survive —
SAM's own upload re-zips and strips them on Windows) -> `sam deploy` with that layer ARN
-> print outputs -> invoke the sample function and report SUCCESS or EXTENSION FAILED.

A successful run ends with:
`SUCCESS - extension launched and function returned: {"statusCode":200,"body":"{\"message\":\"hello world\"}"}`

Then skip to **Step 9** (load test) and **Step 10** (dashboards). The numbered steps
below are the manual, cross-platform equivalent if you prefer to run pieces by hand (for
example on macOS/Linux, where `build-layer.sh` replaces `build-layer.ps1`).

---

## Step 0 — Verify tools and credentials

```bash
node --version
npm --version
sam --version
aws --version
aws sts get-caller-identity
```

`aws sts get-caller-identity` must return your AWS account/role. If not, configure your
credentials for the CLI before continuing.

Also confirm **Amazon Bedrock model access** is enabled in your Region for the Claude
model you will pass as `BedrockModelId` (Bedrock console -> Model access). Without it, the
recommendation pipeline fails at run time.

---

## Step 1 — Build the extension layer

Install the extension's dependencies and assemble the layer directory:

```bash
cd extension/nodejs-example-telemetry-api-extension
npm install
cd ../..
# Windows:
powershell -ExecutionPolicy Bypass -File build-layer.ps1
# macOS / Linux:
# bash build-layer.sh
```

This creates `.build/layer/`. On **Windows**, also package it into a zip that preserves
the extension's Unix executable bit and LF line endings — a plain directory ContentUri
loses `+x` (and a Windows checkout may introduce CRLF), which causes
`Extension.LaunchError: ProcessSpawnFailed` at run time:

```cmd
npm install jszip@3.10.1 --no-save --no-audit --no-fund
node build-layer-zip.mjs
```

This writes `.build/telemetry-extension-layer.zip`, which `template-prebuilt.yaml`
references for the layer. (On macOS/Linux the Makefile/`build-layer.sh` path preserves
these already; `deploy.ps1` automates all of this on Windows.)

---

## Step 2 — Install the Lambda function dependencies

```bash
cd insights/recommendation-engine
npm install
cd ../..
cd insights/cold-start-correlation
npm install
cd ../..
```

---

## Step 3 — Build

```bash
sam build -t template-prebuilt.yaml
```

---

## Step 4 — Deploy (guided)

```bash
sam deploy --guided
```

Enter these values at the prompts:

| Prompt | Value |
|--------|-------|
| Stack Name | `shutdown-pattern-analysis` |
| AWS Region | your Region (for example `us-east-1`) |
| Parameter MetricsLogGroup | `/metrics/lambda-execution-lifecycle` (accept default) |
| Parameter CorrelationWindowMs | `30000` (accept default) |
| Parameter LookbackHours | `24` (accept default) |
| Parameter CorrelationSchedule | `rate(1 hour)` (accept default) |
| Parameter BedrockModelId | a Claude inference profile ID enabled in your Region |
| Parameter PrebuiltLayerArn | leave empty (or supply a pre-published layer ARN — see note) |
| Confirm changes before deploy | `Y` |
| Allow SAM CLI IAM role creation | `Y` |
| SampleFunction may not have authorization defined, Is this okay? | `Y` |
| Save arguments to configuration file | `Y` |

> **Windows note:** `sam deploy` re-zips the layer and strips the executable bit, which
> breaks the extension. Use `deploy.ps1` (which publishes the layer with the AWS CLI and
> passes `PrebuiltLayerArn`), or publish the layer yourself and pass its ARN.

After the change set is shown, confirm the deploy when asked.

---

## Step 5 — Read the stack outputs

```bash
aws cloudformation describe-stacks --stack-name shutdown-pattern-analysis \
  --query "Stacks[0].Outputs" --output table
```

Note: `ApiEndpoint`, `RecommendationPipelineArn`, `DashboardUrl`, `DeepDiveDashboardUrl`.

---

## Step 6 — Smoke-test the API

```bash
curl <ApiEndpoint>
```
Expect: `{"message":"hello world"}`

If you deployed on Windows and get an `Internal server error`, the extension failed to
launch — confirm you used `deploy.ps1` (or a layer published via the AWS CLI).

---

## Step 7 — Confirm the extension is writing telemetry

Send a few requests, wait about a minute, then:

```bash
aws logs describe-log-streams --log-group-name /metrics/lambda-execution-lifecycle \
  --region <Region> --max-items 3
```
Log streams prefixed `ext-` mean the extension is emitting.

---

## Step 8 — Run the load test

The load test is a Bash script (macOS/Linux, or Git Bash / AWS CloudShell on Windows):

```bash
bash test/hello.sh <ApiEndpoint> <Region> <RecommendationPipelineArn>
```

Runtime about 30 min: traffic phases, a 15-minute idle wait, then it auto-starts the
recommendation pipeline over the window it generated. Omit `<RecommendationPipelineArn>`
to run the load test only (about 10 min) and trigger the pipeline manually later.

> The traffic generation runs locally (the script's curl loops), so keep the machine
> awake for the full run, or run the script from AWS CloudShell.

---

## Step 9 — View the dashboards

Open `DashboardUrl` and `DeepDiveDashboardUrl` in the console. Set each dashboard's time
range to cover the load test (the last 1-2 hours). The AI Recommendations widget
populates once the recommendation pipeline reaches `SUCCEEDED`.

---

## Step 10 — Cleanup

```bash
sam delete --stack-name shutdown-pattern-analysis
```

The dedicated metrics log group may be retained after stack deletion; remove it
explicitly if so:

```bash
aws logs delete-log-group --log-group-name /metrics/lambda-execution-lifecycle --region <Region>
```

---

## If something fails

- **`Internal server error` / `Extension.LaunchError: ProcessSpawnFailed`:** the layer's
  executable bit or LF line endings did not survive packaging. Use `deploy.ps1`, or
  publish the layer with the AWS CLI and pass `PrebuiltLayerArn`.
- **`GenerateRecommendations` fails (AccessDenied):** Bedrock model access is not enabled
  in the Region for the `BedrockModelId` you used.
- **Dashboard shows "No data":** the time range does not cover the run, or the pipeline
  has not finished.
