// build-layer-zip.mjs
// Packages .build/layer/ into .build/telemetry-extension-layer.zip with correct
// Unix executable permissions on the extension launcher and index.js.
//
// WHY: On Windows, build-layer.ps1 copies files with Copy-Item and SAM zips the
// ContentUri directory without preserving a Unix executable bit. Lambda then
// cannot spawn the extension process -> Extension.LaunchError: ProcessSpawnFailed.
// This script sets mode 0o755 on the launcher and index.js inside the zip so the
// extension launches correctly. Run it after build-layer.ps1 / build-layer.sh.
//
// Usage:  node build-layer-zip.mjs
// Requires: jszip (installed under extension/nodejs-example-telemetry-api-extension/node_modules
//           after build-layer, or install locally). Falls back to a clear error if missing.

import { readdirSync, readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LAYER_DIR = join(__dirname, '.build', 'layer');
const OUT_ZIP = join(__dirname, '.build', 'telemetry-extension-layer.zip');

if (!existsSync(LAYER_DIR)) {
  console.error(`Layer dir not found: ${LAYER_DIR}\nRun build-layer.ps1 (Windows) or build-layer.sh first.`);
  process.exit(1);
}

// Resolve jszip from this project root's node_modules (a build-time-only dep;
// deliberately NOT inside the extension folder, so it is never packaged into the layer).
// createRequire is anchored on this script file; Node walks up to find node_modules/jszip.
const require = createRequire(import.meta.url);
let JSZip;
try {
  JSZip = require('jszip');
} catch {
  console.error('jszip not found. Install the build-time dependency at the project root:\n  npm install jszip@3.10.1 --no-save --no-audit --no-fund');
  process.exit(1);
}

// Files that MUST be executable inside the layer archive.
const EXECUTABLE_REL = new Set([
  'extensions/nodejs-example-telemetry-api-extension',
  'nodejs-example-telemetry-api-extension/index.js',
]);

const zip = new JSZip();

// The extension launcher and index.js are exec'd via their shebang line on Linux.
// If they carry Windows CRLF line endings, the kernel reads the interpreter as
// "/bin/bash\r" (or "/usr/bin/env node\r") and the spawn fails with
// Extension.LaunchError: ProcessSpawnFailed. Normalize these to LF before zipping.
const NORMALIZE_LF_REL = new Set([
  'extensions/nodejs-example-telemetry-api-extension',
  'nodejs-example-telemetry-api-extension/index.js',
]);

function addDir(absDir, relPrefix) {
  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    const abs = join(absDir, entry.name);
    const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      addDir(abs, rel);
    } else if (entry.isFile()) {
      let data = readFileSync(abs);
      if (NORMALIZE_LF_REL.has(rel)) {
        // CRLF -> LF (remove 0x0D that precedes 0x0A), then write back as bytes.
        const text = data.toString('utf8').replace(/\r\n/g, '\n');
        data = Buffer.from(text, 'utf8');
      }
      const isExec = EXECUTABLE_REL.has(rel);
      zip.file(rel, data, {
        unixPermissions: isExec ? 0o755 : 0o644,
        date: new Date('2024-01-01T00:00:00Z'),
      });
    }
  }
}

addDir(LAYER_DIR, '');

const buf = await zip.generateAsync({
  type: 'nodebuffer',
  platform: 'UNIX',
  compression: 'DEFLATE',
  compressionOptions: { level: 9 },
});

if (existsSync(OUT_ZIP)) rmSync(OUT_ZIP);
writeFileSync(OUT_ZIP, buf);
console.log(`Wrote ${OUT_ZIP} (${buf.length} bytes) with +x on launcher and index.js`);
