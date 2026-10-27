# Security

## Non-Production Disclaimer

This telemetry extension and its sample application are provided as a reference implementation for educational and development purposes. They are **not intended for direct use in production environments** without additional security hardening, testing, and review appropriate to your organization's requirements.

The sample deploys a public, unauthenticated Amazon API Gateway endpoint and grants Amazon Bedrock model invocation to keep the demonstration simple. Review the considerations and hardening recommendations below before adapting any part of this project.

## Reporting Vulnerabilities

If you discover a potential security issue in this project, please report it to AWS Security via email at [aws-security@amazon.com](mailto:aws-security@amazon.com). Please do **not** create a public issue.

## AWS Services Used

This project interacts with the following AWS services:

- **AWS Lambda** — Runs the sample function, the telemetry extension (attached as a Lambda layer), the cold-start correlation function, and the three recommendation-pipeline functions. The extension uses the Lambda Extensions API and the Lambda Telemetry API.
- **Amazon API Gateway** — Exposes a public `GET /hello` endpoint in front of the sample function. It is used only as the load-test target.
- **AWS Step Functions** — Orchestrates the recommendation pipeline (extract metrics, generate recommendations, update dashboard).
- **Amazon CloudWatch Logs** — Stores lifecycle telemetry as Embedded Metric Format (EMF) records in a dedicated log group (`/metrics/lambda-execution-lifecycle`, 14-day retention). The pipeline reads it with CloudWatch Logs Insights queries.
- **Amazon CloudWatch** — Hosts the Overview and Deep Dive dashboards. The correlation function publishes custom metrics, restricted to its own namespace with the `cloudwatch:namespace` condition key.
- **Amazon EventBridge** — Runs the cold-start correlation function on an hourly schedule.
- **Amazon Bedrock** — Generates optimization recommendations from summarized lifecycle metrics.
- **AWS Identity and Access Management (IAM)** — Provides a dedicated execution role for each function, scoped to the specific resources it uses.

## Known Security Considerations

The following items are acknowledged as accepted technical debt in this reference implementation:

1. **Public, unauthenticated sample endpoint** — `GET /hello` has no authorizer, usage plan, throttling, or access logging. It returns a static greeting and exists only as a load-test target, but anyone with the URL can invoke it and drive AWS Lambda and Amazon API Gateway cost.

2. **Broad Amazon Bedrock model scope** — `bedrock:InvokeModel` is granted on `foundation-model/*` and `inference-profile/*` across Regions. A cross-Region inference profile routes requests to foundation models in several Regions, and the model ID is a deploy-time parameter, so the statement is not tied to one model. A compromised function could invoke any model enabled in the account.

3. **AI-generated output is not validated** — The Bedrock response is written to a dashboard text widget as-is, without length limits or link stripping. The model's input is this project's own aggregated metrics, so the injection surface is small, but the output should be treated as untrusted, AI-generated text and reviewed by a person before you act on it.

4. **Functions are not attached to a VPC** — All functions call AWS APIs only and handle no private data, so they run with default Lambda networking and retain internet egress.

5. **No dead-letter queue or failure destination** — The hourly correlation function is invoked asynchronously; failed runs are dropped after Lambda's built-in retries. Pipeline functions are invoked synchronously and rely on Step Functions retries.

6. **No reserved concurrency** — The sample function is intentionally uncapped because the project observes natural scale-up. Without limits, heavy traffic to the public endpoint can consume account concurrency shared with other functions.

7. **AWS managed encryption keys** — Lambda environment variables and the metrics log group are encrypted with AWS managed keys. The environment variables hold non-sensitive configuration (log group name, analysis window, model ID), and the log group holds lifecycle metrics only.

8. **Log content** — The telemetry extension records lifecycle metrics only (timestamps, durations, memory figures, invocation counts, idle gaps, and shutdown reasons). It does not capture request payloads, response bodies, or headers, and the sample handlers log a request ID rather than the invocation event. If you add logging to your own function, ensure it does not write sensitive request data.

## Production Hardening Recommendations

Before using this project in a production environment, consider the following:

### IAM Permissions

Apply the principle of least privilege. To attach the telemetry extension to your own function, the function's execution role needs only these permissions on the dedicated metrics log group:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "logs:CreateLogGroup",
                "logs:CreateLogStream",
                "logs:PutLogEvents"
            ],
            "Resource": [
                "arn:aws:logs:<Region>:<Account>:log-group:/metrics/lambda-execution-lifecycle",
                "arn:aws:logs:<Region>:<Account>:log-group:/metrics/lambda-execution-lifecycle:*"
            ]
        }
    ]
}
```

If you deploy the recommendation pipeline, restrict Amazon Bedrock access to the model family you use instead of all models, for example:

```
arn:aws:bedrock:*::foundation-model/anthropic.claude-*
arn:aws:bedrock:*:<Account>:inference-profile/us.anthropic.claude-*
```

The dashboard-update function is already scoped to its single dashboard (`arn:aws:cloudwatch::<Account>:dashboard/<DashboardName>`). Keep it that way if you add dashboards.

### API Protection

- Require IAM authorization on the API (`Auth: { DefaultAuthorizer: AWS_IAM }`). The load-test script already signs requests with `--aws-sigv4`.
- Alternatively, use an API key with a usage plan and throttling (for example, a burst limit of 50 and a rate limit of 20 requests per second).
- Enable stage access logging, and keep execution logging off so request data is not written to logs.

### Encryption

- If customer managed keys are a compliance requirement, set `KmsKeyArn` on each Lambda function and `KmsKeyId` on the metrics log group. Grant `logs.<region>.amazonaws.com` use of the key in its key policy, and enable key rotation.
- Use **HTTPS** (TLS) for all communication with AWS services. The AWS SDK enforces this by default.

### VPC Endpoints

If you attach the extension to functions that handle private data, run them in private subnets and configure VPC endpoints so traffic stays on the AWS network:

```
com.amazonaws.<region>.logs
com.amazonaws.<region>.monitoring
com.amazonaws.<region>.lambda
com.amazonaws.<region>.bedrock-runtime
```

### Reliability and Concurrency

- Configure an `OnFailure` destination (an Amazon SQS queue with server-side encryption) for asynchronously invoked functions, and add an alarm on it.
- Set `ReservedConcurrentExecutions` (2 to 5) on the pipeline functions, and size the observed function using the provisioned-concurrency sizing data on the Deep Dive dashboard.

### AI Output Handling

- Cap the length of model output and strip links and images before writing it to a dashboard.
- Label the output as AI-generated, and have a person validate recommendations before applying them.
- Consider [Amazon Bedrock Guardrails](https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails.html) to filter model output.

### Logging and Monitoring

- Enable **AWS CloudTrail** to audit Lambda, Step Functions, and Amazon Bedrock API calls.
- Monitor Lambda `Errors` and `Throttles`, Step Functions `ExecutionsFailed`, and Amazon Bedrock invocation metrics to detect unexpected behavior.
- Measure the extension's runtime overhead before leaving it attached to a production function permanently, and remove it once you have the data you need.

### Credential Management

- Do not hardcode AWS credentials in application code or configuration files.
- Store secrets in AWS Secrets Manager or AWS Systems Manager Parameter Store, never in Lambda environment variables.
- Use IAM roles (Lambda execution roles) for deployed functions. For local development and deployment, use short-lived credentials via AWS IAM Identity Center or assumed roles.

## Resource Cleanup

When you are done evaluating this project:

1. **Delete the CloudFormation stack** to remove the functions, layer, API, state machine, IAM roles, and dashboards, and to take the public endpoint offline:

   ```bash
   sam delete --stack-name shutdown-pattern-analysis
   ```

2. **Delete the metrics log group** if it remains after the stack is deleted:

   ```bash
   aws logs delete-log-group --log-group-name /metrics/lambda-execution-lifecycle
   ```

3. **Detach the extension layer** from any of your own functions you attached it to.
4. **Revoke any IAM credentials** created specifically for testing this project.

## Dependencies

This project depends on the following packages. Exact versions are locked in each package's committed `package-lock.json`:

| Package | Version | Used by | Purpose |
|---------|---------|---------|---------|
| @aws-sdk/client-cloudwatch-logs | 3.1152.0 | Telemetry extension | Write EMF records to the metrics log group |
| @aws-sdk/client-cloudwatch-logs | 3.1151.0 | Correlation function, recommendation engine | Run CloudWatch Logs Insights queries |
| @aws-sdk/client-cloudwatch | 3.1151.0 | Recommendation engine | Read and update the dashboard |
| @aws-sdk/client-bedrock-runtime | 3.1151.0 | Recommendation engine | Invoke the Amazon Bedrock model |
| @aws-sdk/client-lambda | 3.1151.0 | Recommendation engine | Invoke the correlation function |
| aws-embedded-metrics | 4.2.1 | Correlation function | Publish correlation metrics in EMF |
| jszip | 3.10.1 | Build time only (not deployed) | Package the extension layer zip with executable file modes |

The telemetry extension otherwise uses only Node.js built-in modules (`http` and the global `fetch`); it has no third-party web framework or HTTP client. The sample function has no runtime dependencies.

All dependencies are well-known, actively maintained packages from AWS and the open-source community. Run `npm audit` in each package directory before deploying, and review and pin dependency versions appropriate to your organization's policies.
