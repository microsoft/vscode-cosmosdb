#!/usr/bin/env node

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// ---------------------------------------------------------------------------
// Generates src/docs/index.ts from the .md files in src/docs/functions/
// and src/docs/keywords/.
//
// Usage:  node scripts/generate-docs-index.mjs
// ---------------------------------------------------------------------------

import * as fs from 'node:fs';
import { generateDocsIndexContent, outFile } from './docs-index-utils.mjs';

const content = generateDocsIndexContent();

fs.writeFileSync(outFile, content, 'utf-8');

console.log(`✅  Generated ${outFile}`);
