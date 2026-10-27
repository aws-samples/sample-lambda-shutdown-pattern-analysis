console.log('Hello from function initalization');

exports.handler = async (event, context) => {
    // Log only the request ID, never the full event: behind API Gateway or SQS
    // the event carries request bodies and headers that must not reach logs.
    console.log('Hello from function handler', { requestId: context.awsRequestId });
}
