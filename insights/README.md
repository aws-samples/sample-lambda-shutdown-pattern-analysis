# CloudWatch Insights Queries for Lambda Shutdown Pattern Analysis

This folder contains CloudWatch Insights queries and a correlation Lambda function for analyzing Lambda execution environment shutdown patterns.

## Cost Optimization: Dedicated Metrics Log Group

All EMF metrics are directed to a dedicated log group (`/metrics/lambda-execution-lifecycle`) instead of the function's default log group. This means Insights queries only scan the small metrics-only log group, not the entire application log stream. This dramatically reduces Insights scan costs.

The extension sets this via `aws-embedded-metrics` `Configuration.logGroupName`, controlled by the `METRICS_LOG_GROUP` environment variable.

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
