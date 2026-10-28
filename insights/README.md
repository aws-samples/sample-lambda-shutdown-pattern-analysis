# CloudWatch Insights Queries for Lambda Shutdown Pattern Analysis

This folder contains CloudWatch Insights queries and a correlation Lambda function for analyzing Lambda execution environment shutdown patterns.

## Cost Optimization: Dedicated Metrics Log Group

All EMF metrics are directed to a dedicated log group (`/metrics/lambda-execution-lifecycle`) instead of the function's default log group. Because Insights queries scan only this dedicated metrics-only log group rather than the full application log stream, they read far less data per query.

The extension builds EMF records and writes them to the dedicated log group via the CloudWatch Logs `PutLogEvents` API. The destination is controlled by the `METRICS_LOG_GROUP` environment variable, defaulting to `/metrics/lambda-execution-lifecycle`.

## Structure

- `analysis-queries.json` — Queries that extract structured data for the AI recommendation engine.
- `dashboard-queries.json` — Queries designed for visual CloudWatch Dashboard widgets.
- `dashboard-template.json` — CloudFormation template that deploys a complete CloudWatch Dashboard.
- `cold-start-correlation/` — Lambda function that correlates cold starts with shutdowns to identify environment churn.
- `template.yaml` — SAM template to deploy the correlation Lambda function.

## Usage

All queries target the dedicated metrics log group `/metrics/lambda-execution-lifecycle`.

## Deploying the Correlation Function

```bash
cd insights
sam build
sam deploy --guided
```

## Deploying the Dashboard

```bash
aws cloudformation deploy \
  --template-file dashboard-template.json \
  --stack-name lambda-shutdown-dashboard \
  --parameter-overrides LogGroupName=/metrics/lambda-execution-lifecycle Region=us-east-1
```
