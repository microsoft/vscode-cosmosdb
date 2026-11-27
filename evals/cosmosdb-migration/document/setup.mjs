/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { existsSync, unlinkSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareDocument } from './fixtures.mjs';

const scenario = process.argv[2];
const copiedEntry = relative(process.cwd(), fileURLToPath(import.meta.url))
    .split(sep)
    .join('/');
assert.ok(
    ['setup.mjs', 'document/setup.mjs'].includes(copiedEntry) && existsSync('cosmosdb-migration/SKILL.md'),
    'Run the copied setup entry only in the staged trial workspace',
);
await prepareDocument(resolve('app'), scenario, resolve('cosmosdb-migration'));
// These are copied setup inputs, not trial evidence. Do not leave future checkpoints in the agent workspace.
unlinkSync(new URL('./fixtures.mjs', import.meta.url));
if (scenario === 'document-planning') unlinkSync(new URL('../document-conversion/accepted.mjs', import.meta.url));
unlinkSync(new URL(import.meta.url));
