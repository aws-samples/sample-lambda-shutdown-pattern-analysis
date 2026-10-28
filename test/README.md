# Load-test script

`test/hello.sh` drives the sample API through a realistic rise/fall/rise/idle traffic
pattern — a scale-up burst, a reduced-load period, a second burst, and then a 15-minute
idle wait. This produces the scale-up, idle periods, shutdowns, and cold starts the
telemetry extension is built to observe. When given a pipeline ARN, the script then
auto-triggers the recommendation analysis over the run's time window.

## Usage

```bash
bash test/hello.sh <ApiEndpoint> <Region> <RecommendationPipelineArn>
```

The run takes about 30 minutes (traffic phases + a 15-minute idle wait + the analysis).
The traffic is generated locally, so keep the machine awake or run it from AWS CloudShell.
See the **Run the load test** section of the root [README.md](../README.md) for context.
