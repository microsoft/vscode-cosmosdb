/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { discoverEvals, loadEvalSpec } from '@microsoft/vally';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { fetchSample } from '../evals/cosmosdb-relational-migration/adventureworks/sample.mjs';
import { requiresAdventureWorksSample, resolveEvalSelection } from './eval-options.mjs';

const { evals, errors } = await discoverEvals([fileURLToPath(new URL('../evals/', import.meta.url))]);
if (errors.length) {
    throw new Error(errors.map(({ path, reason }) => `${path}: ${reason}`).join('\n'));
}
if (!evals.length) {
    throw new Error('No Vally evaluation specs found under evals/.');
}

const { args, filter } = resolveEvalSelection(process.argv.slice(2));
const specs = await Promise.all(evals.map(({ filePath }) => loadEvalSpec(filePath)));
const environment = { ...process.env };
if (requiresAdventureWorksSample(specs, filter)) {
    environment.MIGRATION_EVAL_ADVENTUREWORKS_SOURCE = fetchSample();
}
const require = createRequire(import.meta.url);
const result = spawnSync(
    process.execPath,
    [
        require.resolve('@microsoft/vally-cli/dist/index.js'),
        'eval',
        '--grader-plugin',
        fileURLToPath(new URL('../evals/cosmosdb-migration/check-artifacts.mjs', import.meta.url)),
        '--grader-plugin',
        fileURLToPath(new URL('../evals/cosmosdb-relational-migration/check-artifacts.mjs', import.meta.url)),
        '--grader-plugin',
        fileURLToPath(
            new URL('../evals/cosmosdb-relational-migration/adventureworks/check-artifacts.mjs', import.meta.url),
        ),
        ...evals.flatMap(({ filePath }) => ['--eval-spec', filePath]),
        ...args,
    ],
    { stdio: 'inherit', env: environment },
);
if (result.error) {
    throw result.error;
}
if (result.signal) {
    throw new Error(`Vally terminated by signal ${result.signal}.`);
}
process.exitCode = result.status ?? 1;
