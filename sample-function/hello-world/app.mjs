/**
 *
 * Event doc: https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html#api-gateway-simple-proxy-for-lambda-input-format
 * @param {Object} event - API Gateway Lambda Proxy Input Format
 *
 * Context doc: https://docs.aws.amazon.com/lambda/latest/dg/nodejs-prog-model-context.html 
 * @param {Object} context
 *
 * Return doc: https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html
 * @returns {Object} object - API Gateway Lambda Proxy Output Format
 * 
 */

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export const lambdaHandler = async (event, context) => {
    try {
        let max = 1000, min = 200;
        let snoozeFor = Math.floor(Math.random() * (max - min + 1)) + min;
        console.log(`Waiting for ${snoozeFor} milliseconds.`)
        await sleep(snoozeFor);
        console.log(`Resuming operation...`)
        return {
            'statusCode': 200,
            'body': JSON.stringify({
                message: 'hello world',
            })
        }
    } catch (err) {
        // Log the detail server-side; return a generic error so the caller
        // never sees internal error shape.
        console.error(err);
        return {
            'statusCode': 500,
            'body': JSON.stringify({ message: 'Internal error' })
        };
    }
};
