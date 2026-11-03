/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { buildDataModel, createBlankContainer } from './dataModel';
import { DATA_MODEL_DEFAULTS } from './dataModelDefaults';
import { type ContainerModel, type ScenarioId, type WriteDistribution } from './models';
import {
    assessContainerThroughput,
    DEFAULT_MAX_RU_PER_CONTAINER,
    estimateContainerThroughput,
    MAX_ESTIMATED_RU_PER_CONTAINER,
    MAX_RU_PER_PHYSICAL_PARTITION,
    parseCountInput,
    validateCount,
} from './workloadLimits';

function container(readQps: number, writesPerSec: number, writes: WriteDistribution = 'even'): ContainerModel {
    const result = createBlankContainer();
    // 1 KB documents: 1 RU per read, 3 RU per write.
    result.document.avgSizeKb = 1;
    result.reads = [{ id: 'read', pattern: '', query: '', filters: [], qps: readQps }];
    result.writes = { insertsPerSec: writesPerSec, updatesPerSec: 0, deletesPerSec: 0 };
    result.scale.writes = writes;
    return result;
}

describe('validateCount', () => {
    it.each([
        { value: 0, max: 10, expected: undefined },
        { value: 10, max: 10, expected: undefined },
        { value: 11, max: 10, expected: 'tooLarge' },
        { value: -1, max: 10, expected: 'negative' },
        { value: 1.5, max: 10, expected: 'fraction' },
        { value: NaN, max: 10, expected: 'invalid' },
        { value: Infinity, max: 10, expected: 'invalid' },
    ])('returns $expected for $value with max $max', ({ value, max, expected }) => {
        expect(validateCount(value, max)).toBe(expected);
    });

    it('accepts fractions when allowed', () => {
        expect(validateCount(1.5, 10, true)).toBeUndefined();
        expect(validateCount(10.5, 10, true)).toBe('tooLarge');
    });

    it('treats an empty input as zero', () => {
        expect(parseCountInput('')).toBe(0);
        expect(parseCountInput(' 12 ')).toBe(12);
        expect(parseCountInput('abc')).toBeNaN();
    });
});

describe('assessContainerThroughput', () => {
    it('sums read and write RU/s', () => {
        expect(estimateContainerThroughput(container(100, 10))).toEqual({
            readRuPerSec: 100,
            writeRuPerSec: 30,
            totalRuPerSec: 130,
        });
    });

    it('warns only above the default per-container limit', () => {
        expect(assessContainerThroughput(container(DEFAULT_MAX_RU_PER_CONTAINER, 0))).toEqual([]);
        expect(assessContainerThroughput(container(DEFAULT_MAX_RU_PER_CONTAINER + 1, 0))).toEqual([
            { kind: 'containerLimit', severity: 'warning', ruPerSec: DEFAULT_MAX_RU_PER_CONTAINER + 1 },
        ]);
    });

    it('blocks only beyond the unrealistic ceiling', () => {
        const atCeiling = container(MAX_ESTIMATED_RU_PER_CONTAINER, 0);
        expect(assessContainerThroughput(atCeiling).map((issue) => issue.kind)).toEqual(['containerLimit']);
        const beyond = container(MAX_ESTIMATED_RU_PER_CONTAINER + 1, 0);
        expect(assessContainerThroughput(beyond)).toEqual([
            { kind: 'unrealistic', severity: 'error', ruPerSec: MAX_ESTIMATED_RU_PER_CONTAINER + 1 },
        ]);
    });

    it.each(['skewed', 'time'] as const)('warns about a hot partition for %s writes', (writes) => {
        // 3,334 writes × 3 RU = 10,002 RU/s, just above one physical partition.
        expect(assessContainerThroughput(container(0, 3333, writes))).toEqual([]);
        expect(assessContainerThroughput(container(0, 3334, writes))).toEqual([
            { kind: 'hotPartition', severity: 'warning', ruPerSec: 10_002 },
        ]);
    });

    it('does not warn about a hot partition for evenly distributed writes', () => {
        expect(MAX_RU_PER_PHYSICAL_PARTITION).toBe(10_000);
        expect(assessContainerThroughput(container(0, 100_000, 'even'))).toEqual([]);
    });

    it('accepts every scenario default without blocking errors', () => {
        for (const scenario of Object.keys(DATA_MODEL_DEFAULTS) as ScenarioId[]) {
            for (const model of buildDataModel(scenario).containers) {
                expect(assessContainerThroughput(model).filter((issue) => issue.severity === 'error')).toEqual([]);
            }
        }
    });
});
