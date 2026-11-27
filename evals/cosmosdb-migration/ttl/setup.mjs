/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { realpathSync, rmSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareTtlFixture } from './fixture.mjs';

const stage = realpathSync('.');
const skill = join(stage, 'cosmosdb-migration');
assert.equal(fileURLToPath(import.meta.url), join(stage, 'setup.mjs'), 'Run only the staged fixture setup');
assert.equal(realpathSync(skill), skill, 'Expected a local copy of the migration skill');
await prepareTtlFixture(resolve('app'), skill);
// The executor receives only the review artifacts and runtime skill, not the code that planted the defects.
rmSync(join(skill, 'tests'), { recursive: true });
unlinkSync(new URL('./fixture.mjs', import.meta.url));
unlinkSync(new URL(import.meta.url));
