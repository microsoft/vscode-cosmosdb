/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { executeCase, SUPPORTED_DETECTORS, validateBindings } from './bindings';
import { loadFeatures } from './features';

const featureRoot = process.env.CODA_FEATURE_ROOT;
const commit = process.env.CODA_COMMIT;
const reportFile = process.env.CODA_REPORT;
if (!featureRoot || !commit || !reportFile) {
    throw new Error('Use npm run test:coda to verify the pinned checkout before executing private features.');
}
const inventory = loadFeatures(featureRoot);
const filter = process.env.CODA_DETECTORS?.split(',').filter(Boolean) ?? [];
for (const detector of filter) {
    if (!inventory.some((entry) => entry.detector === detector)) {
        throw new Error(`No scenarios found for requested detector ${detector}.`);
    }
}
const selected = inventory.filter((entry) => filter.length === 0 || filter.includes(entry.detector));
const results = inventory.map((entry) => ({
    detector: entry.detector,
    file: path.relative(featureRoot, entry.file),
    id: entry.pickle.id,
    name: entry.pickle.name,
    status: selected.includes(entry) ? 'notRun' : 'notSelected',
    checks: 0,
}));

afterAll(() => {
    const counts = Object.fromEntries(
        ['passed', 'failed', 'unbound', 'notSelected', 'notRun'].map((status) => [
            status,
            results.filter((result) => result.status === status).length,
        ]),
    );
    mkdirSync(path.dirname(reportFile), { recursive: true });
    writeFileSync(
        reportFile,
        JSON.stringify(
            {
                commit,
                generatedAt: new Date().toISOString(),
                total: inventory.length,
                selected: selected.length,
                supportedDetectors: [...SUPPORTED_DETECTORS],
                counts,
                scenarios: results,
            },
            null,
            2,
        ) + '\n',
    );
    console.log(`CODA inventory: ${inventory.length}; selected: ${selected.length}; ${JSON.stringify(counts)}.`);
});

describe('pinned CODA features against native production evaluators', () => {
    for (const testCase of selected) {
        it(`${testCase.detector} ${path.basename(testCase.file)}:${testCase.pickle.id} ${testCase.pickle.name}`, async () => {
            const result = results[inventory.indexOf(testCase)];
            try {
                validateBindings(testCase);
            } catch (error) {
                result.status = 'unbound';
                throw error;
            }
            try {
                result.checks = await executeCase(testCase);
                expect(result.checks).toBeGreaterThan(0);
                result.status = 'passed';
            } catch (error) {
                result.status = 'failed';
                throw error;
            }
        });
    }
});
