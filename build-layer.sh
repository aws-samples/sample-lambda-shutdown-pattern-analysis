#!/bin/bash
# Pre-build script: assembles the extension layer directory for SAM
# Run this before 'sam build' on systems without make

set -e

echo "Building extension layer..."

LAYER_DIR=".build/layer"
rm -rf "$LAYER_DIR"
mkdir -p "$LAYER_DIR/extensions"
mkdir -p "$LAYER_DIR/nodejs-example-telemetry-api-extension"

# Install dependencies
cd extension/nodejs-example-telemetry-api-extension
npm install
cd ../..

# Copy extension files
cp extension/extensions/nodejs-example-telemetry-api-extension "$LAYER_DIR/extensions/"
chmod +x "$LAYER_DIR/extensions/nodejs-example-telemetry-api-extension"

cp -R extension/nodejs-example-telemetry-api-extension/* "$LAYER_DIR/nodejs-example-telemetry-api-extension/"
chmod +x "$LAYER_DIR/nodejs-example-telemetry-api-extension/index.js"

echo "Layer assembled at $LAYER_DIR"
