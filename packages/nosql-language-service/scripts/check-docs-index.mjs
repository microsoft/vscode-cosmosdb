#!/usr/bin/env node

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// ---------------------------------------------------------------------------
// Verifies that src/docs/index.ts is up to date with the .md source files.
// Exits with code 1 if it's stale — intended for CI pipelines.
//
// Usage:  node scripts/check-docs-index.mjs
// ---------------------------------------------------------------------------

import * as fs from 'node:fs';
import { generateDocsIndexContent, outFile } from './docs-index-utils.mjs';

const expected = generateDocsIndexContent();

if (!fs.existsSync(outFile)) {
    console.error(`❌  ${outFile} does not exist.`);
    console.error('    Run "pnpm run generate-docs" to create it.');
    process.exit(1);
}

const actual = fs.readFileSync(outFile, 'utf-8');

if (actual === expected) {
    console.log('✅  src/docs/index.ts is up to date.');
    process.exit(0);
}

// Show a short diff hint
const actualLines = actual.split('\n');
const expectedLines = expected.split('\n');

let firstDiffLine = -1;
const maxLines = Math.max(actualLines.length, expectedLines.length);
for (let i = 0; i < maxLines; i++) {
    if (actualLines[i] !== expectedLines[i]) {
        firstDiffLine = i + 1;
        break;
    }
}

console.error('❌  src/docs/index.ts is out of date with the .md source files.');
if (firstDiffLine > 0) {
    console.error(`    First difference at line ${firstDiffLine}.`);
}
console.error('    Run "pnpm run generate-docs" to regenerate it.');
process.exit(1);

