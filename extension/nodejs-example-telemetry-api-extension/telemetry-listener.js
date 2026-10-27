// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

// Minimal HTTP listener for Telemetry API events, using Node's built-in `http`
// module (no third-party web framework). The Lambda Telemetry API POSTs batches
// of platform events here; we parse the JSON body and push them onto a shared
// queue that the main loop drains.

const http = require('http');

const LISTENER_HOST = process.env.AWS_SAM_LOCAL === 'true' ? '0.0.0.0' : 'sandbox.localdomain';
const LISTENER_PORT = 4243;
const MAX_BODY_BYTES = 512 * 1024; // guard against unbounded buffering

const eventsQueue = [];

function start() {
    const server = http.createServer((req, res) => {
        if (req.method !== 'POST') {
            res.writeHead(405);
            res.end();
            return;
        }

        const chunks = [];
        let size = 0;
        let aborted = false;

        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
                aborted = true;
                res.writeHead(413);
                res.end();
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });

        req.on('end', () => {
            if (aborted) return;
            try {
                const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                if (Array.isArray(body) && body.length > 0) {
                    eventsQueue.push(...body);
                }
            } catch (err) {
                // Logging here can create a telemetry feedback loop if function
                // logs are subscribed; swallow parse errors quietly.
            }
            res.writeHead(200);
            res.end('OK');
        });
    });

    const listenerUrl = `http://${LISTENER_HOST}:${LISTENER_PORT}`;
    server.listen(LISTENER_PORT, LISTENER_HOST, () => {
        console.log(`listening at ${listenerUrl}`);
    });

    return listenerUrl;
}

module.exports = {
    start,
    eventsQueue
};
