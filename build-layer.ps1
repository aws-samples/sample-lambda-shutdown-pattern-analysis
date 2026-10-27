# Pre-build script for Windows: assembles the extension layer directory for SAM.
# Run this before 'sam build' on Windows (deploy.ps1 calls it for you).
#
# It copies the extension SOURCE into .build/layer and installs production
# dependencies there (npm install --omit=dev) rather than copying a pre-existing
# node_modules tree. Copying node_modules with Copy-Item fails on Windows with
# PathTooLongException because the nested AWS SDK paths exceed MAX_PATH (260).

$ErrorActionPreference = "Stop"

Write-Host "Building extension layer..."

$LAYER_DIR = ".build/layer"
$EXT_SRC = "extension/nodejs-example-telemetry-api-extension"
$EXT_DEST = "$LAYER_DIR/nodejs-example-telemetry-api-extension"

if (Test-Path $LAYER_DIR) { Remove-Item -Recurse -Force $LAYER_DIR }
New-Item -ItemType Directory -Path "$LAYER_DIR/extensions" -Force | Out-Null
New-Item -ItemType Directory -Path $EXT_DEST -Force | Out-Null

# Copy the extension launcher.
Copy-Item "extension/extensions/nodejs-example-telemetry-api-extension" "$LAYER_DIR/extensions/" -Force

# Copy ONLY the extension source files (no node_modules) into the destination.
Get-ChildItem -Path $EXT_SRC -File | Where-Object { $_.Name -ne "package-lock.json" -or $true } | ForEach-Object {
  Copy-Item $_.FullName $EXT_DEST -Force
}

# Install production dependencies directly in the destination (short base path,
# so the nested SDK paths stay under MAX_PATH).
Push-Location $EXT_DEST
try {
  npm install --omit=dev --no-audit --no-fund
} finally {
  Pop-Location
}

Write-Host "Layer assembled at $LAYER_DIR"
