#!/bin/bash

# Usage: ./hello.sh <API_GATEWAY_URL> <REGION> [STEP_FUNCTION_ARN]
# Example: ./hello.sh https://abc123.execute-api.us-east-1.amazonaws.com/Stage/hello us-east-1 arn:aws:states:us-east-1:123456:stateMachine:shutdown-pattern-recommendation-pipeline
#
# If STEP_FUNCTION_ARN is provided, the script will:
# 1. Run the load test
# 2. Wait for environments to shut down
# 3. Trigger the recommendation pipeline

API_URL="${1:?Error: API Gateway URL required as first argument}"
REGION="${2:-us-east-1}"
STEP_FUNCTION_ARN="${3:-}"

# Record start time for the analysis window
LOAD_TEST_START=$(date +%s)

function send_requests() {
    local num_requests=$1
    local parallel=$2
    
    (seq 1 $num_requests | xargs -P$parallel -I{} curl -s --header "X-Iteration: {}" \
        "$API_URL" \
        --aws-sigv4 "aws:amz:$REGION:execute-api" &>/dev/null) &
}

echo "============================================"
echo "Lambda Shutdown Pattern Analysis - Load Test"
echo "============================================"
echo ""
echo "API URL: $API_URL"
echo "Region: $REGION"
echo "Start time: $(date -u '+%Y-%m-%dT%H:%M:%SZ') (epoch: $LOAD_TEST_START)"
if [ -n "$STEP_FUNCTION_ARN" ]; then
    echo "Pipeline: $STEP_FUNCTION_ARN"
fi
echo ""

# ---- Phase 1: High load (1 minute) ----
echo "--- Phase 1: High load (1 min) - Spinning up environments ---"
start_time=$(date +%s)
phase1_end=$((start_time + 60))

while [ $(date +%s) -lt $phase1_end ]; do
    elapsed=$(($(date +%s) - start_time))
    echo "[${elapsed}s] Sending 40 requests (20 parallel)"
    send_requests 40 20
    sleep 5
done

# ---- Phase 2: Reduced load (6 minutes) ----
echo ""
echo "--- Phase 2: Reduced load (6 min) - Some environments go idle ---"
phase2_end=$((phase1_end + 360))

while [ $(date +%s) -lt $phase2_end ]; do
    elapsed=$(($(date +%s) - start_time))
    echo "[${elapsed}s] Sending 20 requests (10 parallel)"
    send_requests 20 10
    sleep 5
done

# ---- Phase 3: High load again (3 minutes) ----
echo ""
echo "--- Phase 3: High load (3 min) - Triggering cold starts after shutdowns ---"
phase3_end=$((phase2_end + 180))

while [ $(date +%s) -lt $phase3_end ]; do
    elapsed=$(($(date +%s) - start_time))
    echo "[${elapsed}s] Sending 40 requests (20 parallel)"
    send_requests 40 20
    sleep 5
done

LOAD_TEST_END=$(date +%s)
echo ""
echo "Load test completed at: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "Duration: $(( (LOAD_TEST_END - start_time) / 60 )) minutes"
echo ""

# ---- Phase 4: Wait for shutdowns (15 minutes) ----
echo "--- Phase 4: Waiting for environments to shut down (15 min) ---"
echo "No traffic being sent. Lambda will recycle idle environments."
echo ""

WAIT_DURATION=900  # 15 minutes
WAIT_END=$(($(date +%s) + WAIT_DURATION))
while [ $(date +%s) -lt $WAIT_END ]; do
    remaining=$(( (WAIT_END - $(date +%s)) / 60 ))
    echo "  Waiting... ${remaining} minutes remaining"
    sleep 60
done

ANALYSIS_END=$(date +%s)
echo ""
echo "Shutdown wait complete at: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo ""

# ---- Phase 5: Trigger recommendation pipeline ----
if [ -n "$STEP_FUNCTION_ARN" ]; then
    echo "--- Phase 5: Triggering AI Recommendation Pipeline ---"
    echo "Analysis window: $LOAD_TEST_START to $ANALYSIS_END"
    echo "  Start: $(date -u -d @$LOAD_TEST_START '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date -u -r $LOAD_TEST_START '+%Y-%m-%dT%H:%M:%SZ')"
    echo "  End:   $(date -u -d @$ANALYSIS_END '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date -u -r $ANALYSIS_END '+%Y-%m-%dT%H:%M:%SZ')"
    echo ""

    EXECUTION_ARN=$(aws stepfunctions start-execution \
        --state-machine-arn "$STEP_FUNCTION_ARN" \
        --input "{\"startTime\": $LOAD_TEST_START, \"endTime\": $ANALYSIS_END}" \
        --query "executionArn" \
        --output text \
        --region "$REGION")

    if [ $? -eq 0 ]; then
        echo "Pipeline started: $EXECUTION_ARN"
        echo ""
        echo "Waiting for pipeline to complete..."

        # Poll for completion
        STATUS="RUNNING"
        while [ "$STATUS" = "RUNNING" ]; do
            sleep 15
            STATUS=$(aws stepfunctions describe-execution \
                --execution-arn "$EXECUTION_ARN" \
                --query "status" \
                --output text \
                --region "$REGION")
            echo "  Status: $STATUS"
        done

        echo ""
        if [ "$STATUS" = "SUCCEEDED" ]; then
            echo "============================================"
            echo "Pipeline completed successfully!"
            echo "============================================"
            echo ""
            echo "View the dashboard with AI recommendations:"
            echo "  https://${REGION}.console.aws.amazon.com/cloudwatch/home?region=${REGION}#dashboards:name=Lambda-Shutdown-Pattern-Analysis"
        else
            echo "Pipeline finished with status: $STATUS"
            echo "Check Step Functions console for details."
        fi
    else
        echo "Failed to start pipeline. Check AWS credentials and Step Function ARN."
    fi
else
    echo "--- No Step Function ARN provided ---"
    echo "To run the recommendation pipeline manually:"
    echo ""
    echo "  aws stepfunctions start-execution \\"
    echo "    --state-machine-arn <PIPELINE_ARN> \\"
    echo "    --input '{\"startTime\": $LOAD_TEST_START, \"endTime\": $ANALYSIS_END}'"
    echo ""
    echo "Get the pipeline ARN from stack outputs:"
    echo "  aws cloudformation describe-stacks --stack-name shutdown-pattern-analysis \\"
    echo "    --query \"Stacks[0].Outputs[?OutputKey=='RecommendationPipelineArn'].OutputValue\" --output text"
fi

echo ""
echo "Done."
