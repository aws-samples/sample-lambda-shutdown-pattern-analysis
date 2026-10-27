# deploy.ps1 — one-shot build + deploy for the Lambda Shutdown Pattern Analysis stack (path B / SAM).
#
# Runs the full sequence so you don't execute each command by hand:
#   1. install the telemetry extension's npm deps
#   2. assemble the layer directory (build-layer.ps1)
#   3. package the layer zip WITH the Unix +x bit (build-layer-zip.mjs)  <-- required on Windows
#   4. install npm deps for every Node.js Lambda (recommendation-engine, cold-start-correlation)
#   5. sam build
#   6. sam deploy
#
# Usage (from Windows CMD or PowerShell), run from anywhere:
#   powershell -ExecutionPolicy Bypass -File deploy.ps1
#   powershell -ExecutionPolicy Bypass -File deploy.ps1 -Region us-east-1 -StackName shutdown-pattern-analysis
#   powershell -ExecutionPolicy Bypass -File deploy.ps1 -Guided        # force the guided prompts
#   powershell -ExecutionPolicy Bypass -File deploy.ps1 -SkipDeploy    # build only, no deploy
#
# Requires: Node.js + npm, AWS SAM CLI, AWS CLI with valid credentials.

[CmdletBinding()]
param(
  [string]$Region = "us-east-1",
  [string]$StackName = "shutdown-pattern-analysis",
  [string]$BedrockModelId = "us.anthropic.claude-sonnet-4-6",
  [switch]$Guided,
  [switch]$SkipDeploy,
  [switch]$DeleteFirst,   # sam delete the stack before building/deploying (clean slate)
  [switch]$DeleteOnly     # just delete the stack and exit
)

$ErrorActionPreference = "Stop"
# Project root = the folder this script lives in.
$Root = $PSScriptRoot
Set-Location $Root

Write-Host "==================================================================="
Write-Host " Lambda Shutdown Pattern Analysis - build & deploy"
Write-Host " Root:   $Root"
Write-Host " Region: $Region    Stack: $StackName"
Write-Host "==================================================================="

# --- Resolve tool executables (handle tools not being on PATH) ------------------
function Resolve-Tool {
  param([string]$Name, [string[]]$Candidates)
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  foreach ($c in $Candidates) {
    if ($c -and (Test-Path $c)) { return $c }
    # support bare directory globs
    $g = Get-ChildItem $c -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($g) { return $g.FullName }
  }
  return $null
}

$nodeExe = Resolve-Tool "node" @(
  "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\OpenJS.NodeJS.LTS_*\node-*\node.exe",
  "$env:ProgramFiles\nodejs\node.exe"
)
$npmCmd = Resolve-Tool "npm" @(
  "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\OpenJS.NodeJS.LTS_*\node-*\npm.cmd",
  "$env:ProgramFiles\nodejs\npm.cmd"
)
$samCmd = Resolve-Tool "sam" @(
  "$env:ProgramFiles\Amazon\AWSSAMCLI\bin\sam.cmd",
  "${env:ProgramFiles(x86)}\Amazon\AWSSAMCLI\bin\sam.cmd"
)

if (-not $nodeExe) { throw "Node.js not found. Install Node.js and retry." }
if (-not $npmCmd)  { throw "npm not found. Install Node.js (includes npm) and retry." }
if (-not $samCmd -and -not $SkipDeploy) { throw "AWS SAM CLI not found. Install it or use -SkipDeploy." }

Write-Host "node: $nodeExe"
Write-Host "npm:  $npmCmd"
Write-Host "sam:  $samCmd"
Write-Host ""

# --- Optional: delete the stack first (clean slate) -----------------------------
if ($DeleteFirst -or $DeleteOnly) {
  Write-Host "--- Deleting stack '$StackName' (sam delete) ---" -ForegroundColor Yellow
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  & $samCmd delete --stack-name $StackName --region $Region --no-prompts 2>&1
  $ErrorActionPreference = $prevEap
  # Best-effort: remove the dedicated metrics log group (retained after stack delete).
  # Wrapped so a missing log group (or any stderr) never aborts the script.
  Write-Host "  Removing metrics log group (if present)..."
  try {
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    & aws logs delete-log-group --log-group-name "/metrics/lambda-execution-lifecycle" --region $Region 2>&1 | Out-Null
    $ErrorActionPreference = $prev
  } catch {
    Write-Host "  (metrics log group not present or already removed - continuing)"
  }
  Write-Host "Stack delete requested." -ForegroundColor Yellow
  Write-Host ""
  if ($DeleteOnly) { Write-Host "DeleteOnly set: exiting." -ForegroundColor Green; return }
}

function Invoke-Step {
  param([string]$Title, [scriptblock]$Action)
  Write-Host "--- $Title ---" -ForegroundColor Cyan
  & $Action
  if ($LASTEXITCODE -ne 0 -and $null -ne $LASTEXITCODE) { throw "Step failed: $Title (exit $LASTEXITCODE)" }
  Write-Host ""
}

# --- 1. Extension npm deps ------------------------------------------------------
Invoke-Step "1/6 Installing telemetry extension dependencies" {
  Push-Location "$Root\extension\nodejs-example-telemetry-api-extension"
  & $npmCmd install --no-audit --no-fund
  Pop-Location
}

# --- 2. Assemble the layer directory -------------------------------------------
Invoke-Step "2/6 Assembling layer directory (build-layer.ps1)" {
  & powershell -ExecutionPolicy Bypass -File "$Root\build-layer.ps1"
}

# --- 3. Package the layer zip with +x on launcher + index.js --------------------
Invoke-Step "3/6 Packaging layer zip with executable bits (build-layer-zip.mjs)" {
  if (-not (Test-Path "$Root\node_modules\jszip")) {
    & $npmCmd install jszip@3.10.1 --no-save --no-audit --no-fund
  }
  & $nodeExe "$Root\build-layer-zip.mjs"
}

# --- 4. Lambda function npm deps -----------------------------------------------
Invoke-Step "4/6 Installing Lambda function dependencies" {
  foreach ($fn in @("insights\recommendation-engine", "insights\cold-start-correlation")) {
    Write-Host "  -> $fn"
    Push-Location "$Root\$fn"
    & $npmCmd install --no-audit --no-fund
    Pop-Location
  }
}

# --- 5. sam build ---------------------------------------------------------------
if ($SkipDeploy) {
  Write-Host "SkipDeploy set: stopping after build artifacts are prepared." -ForegroundColor Yellow
  Invoke-Step "sam build" { & $samCmd build -t template-prebuilt.yaml }
  Write-Host "Build complete (SkipDeploy). The layer zip is at .build\telemetry-extension-layer.zip." -ForegroundColor Green
  return
}

Invoke-Step "5/7 sam build" { & $samCmd build -t template-prebuilt.yaml }

# --- 6. Publish the extension layer directly (preserves the +x bit) -------------
# SAM's deploy/upload re-zips a LayerVersion ContentUri on Windows and strips the
# Unix executable bit, which breaks the extension (ProcessSpawnFailed). The AWS CLI
# uploads our zip byte-for-byte, so we publish the layer here and pass its ARN to the
# stack via the PrebuiltLayerArn parameter.
$script:LayerArn = ""
Invoke-Step "6/7 Publishing extension layer (aws lambda publish-layer-version)" {
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  $layerZip = "$Root\.build\telemetry-extension-layer.zip"
  $arn = & aws lambda publish-layer-version `
      --layer-name shutdown-pattern-telemetry-extension `
      --compatible-runtimes nodejs22.x `
      --license-info MIT-0 `
      --zip-file "fileb://$layerZip" `
      --region $Region `
      --query LayerVersionArn --output text 2>&1
  $ErrorActionPreference = $prev
  $script:LayerArn = ($arn | Select-Object -Last 1).ToString().Trim()
  Write-Host "  Published layer: $script:LayerArn"
  if ($script:LayerArn -notmatch '^arn:aws:lambda:') { throw "Failed to publish layer. Output: $arn" }
}

# --- 7. sam deploy (passing the pre-published layer ARN) ------------------------
Invoke-Step "7/7 sam deploy" {
  $overrides = "BedrockModelId=$BedrockModelId PrebuiltLayerArn=$script:LayerArn"
  $useGuided = $Guided -or -not (Test-Path "$Root\samconfig.toml")
  if ($useGuided) {
    Write-Host "Running guided deploy (first run or -Guided). Suggested answers:" -ForegroundColor Yellow
    Write-Host "  Stack name: $StackName   Region: $Region   BedrockModelId: $BedrockModelId"
    Write-Host "  Allow IAM role creation: Y   SampleFunction auth warning: Y   Save args: Y"
    & $samCmd deploy --guided --stack-name $StackName --region $Region `
        --parameter-overrides $overrides `
        --capabilities CAPABILITY_IAM
  } else {
    & $samCmd deploy --stack-name $StackName --region $Region `
        --parameter-overrides $overrides `
        --capabilities CAPABILITY_IAM `
        --no-confirm-changeset
  }
}

# AWS CLI can write to stderr even on success; relax error handling for these calls
# so they never abort the script via NativeCommandError.
$ErrorActionPreference = "Continue"

Write-Host "==================================================================="
Write-Host " Done. Fetching stack outputs..." -ForegroundColor Green
Write-Host "==================================================================="
& aws cloudformation describe-stacks --stack-name $StackName --region $Region `
    --query "Stacks[0].Outputs" --output table 2>&1

# --- Verify the extension actually launches (direct invoke) ---------------------
Write-Host ""
Write-Host "--- Verifying: invoking sample function directly ---" -ForegroundColor Cyan
$respFile = Join-Path $Root "deploy-verify-response.json"
& aws lambda invoke --function-name shutdown-pattern-sample-function --region $Region `
    --payload "{}" --cli-binary-format raw-in-base64-out $respFile 2>&1 | Out-Null
$resp = Get-Content $respFile -Raw
if ($resp -match "ProcessSpawnFailed" -or $resp -match "Extension.LaunchError") {
  Write-Host "EXTENSION FAILED TO LAUNCH:" -ForegroundColor Red
  Write-Host $resp
  Write-Host "The layer's executable bit did not survive to Lambda. See notes in deploy.ps1." -ForegroundColor Red
} elseif ($resp -match "errorType|FunctionError") {
  Write-Host "Function returned an error:" -ForegroundColor Red
  Write-Host $resp
} else {
  Write-Host "SUCCESS - extension launched and function returned:" -ForegroundColor Green
  Write-Host $resp
}
