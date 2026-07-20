/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { DEFAULT_HEALTH_THRESHOLDS, getInventoryMetrics, type HealthThresholds } from './inventoryMetrics';
import { DEFAULT_PARTITION_THRESHOLDS, getPartitionHealth } from './partitionHealth';
import { getRuTrends } from './ruTrends';
import { classifyUnavailable, effectiveInterval, pickPointValue } from './shared';
import { mockClient, throwingClient } from './testFixtures';

const thresholds: HealthThresholds = DEFAULT_HEALTH_THRESHOLDS;

describe('pickPointValue', () => {
    const point = { maximum: 90, average: 42, total: 1200 };

    it('reads the field matching the aggregation', () => {
        expect(pickPointValue(point, 'Maximum')).toBe(90);
        expect(pickPointValue(point, 'Average')).toBe(42);
        expect(pickPointValue(point, 'Total')).toBe(1200);
    });

    it('returns undefined when the requested aggregation is absent', () => {
        expect(pickPointValue({ maximum: 5 }, 'Average')).toBeUndefined();
        expect(pickPointValue({ average: 5 }, 'Total')).toBeUndefined();
        expect(pickPointValue({ total: 5 }, 'Maximum')).toBeUndefined();
    });

    it('preserves zero as a real value rather than treating it as missing', () => {
        expect(pickPointValue({ total: 0 }, 'Total')).toBe(0);
    });
});

describe('effectiveInterval', () => {
    it('leaves the interval unchanged when the metric has no coarser floor', () => {
        expect(effectiveInterval('PT1M', undefined)).toBe('PT1M');
        expect(effectiveInterval('PT1H', undefined)).toBe('PT1H');
    });

    it('bumps a finer interval up to the metric floor', () => {
        expect(effectiveInterval('PT1M', 'PT5M')).toBe('PT5M');
        expect(effectiveInterval('PT5M', 'PT1H')).toBe('PT1H');
    });

    it('keeps the interval when it is already at or coarser than the floor', () => {
        expect(effectiveInterval('PT5M', 'PT5M')).toBe('PT5M');
        expect(effectiveInterval('PT1H', 'PT5M')).toBe('PT1H');
    });
});

describe('classifyUnavailable', () => {
    it('maps 403 status codes to rbac', () => {
        expect(classifyUnavailable({ statusCode: 403 })).toBe('rbac');
        expect(classifyUnavailable({ code: 403 })).toBe('rbac');
    });

    it('maps ARM authorization codes to rbac', () => {
        expect(classifyUnavailable({ code: 'AuthorizationFailed' })).toBe('rbac');
        expect(classifyUnavailable({ code: 'Forbidden' })).toBe('rbac');
    });

    it('maps every other error (or none) to noData', () => {
        expect(classifyUnavailable({ statusCode: 500 })).toBe('noData');
        expect(classifyUnavailable(new Error('boom'))).toBe('noData');
        expect(classifyUnavailable(undefined)).toBe('noData');
        expect(classifyUnavailable('nope')).toBe('noData');
    });
});

// The empty-state reason is classified inside `shared.classifyUnavailable` but surfaced by each
// zone service. These cross-zone checks assert the plumbing carries the reason through unchanged.
describe('unavailable reason plumbing', () => {
    const partitionThresholds = DEFAULT_PARTITION_THRESHOLDS;

    it('tags an empty RU trends result as noData', async () => {
        const result = await getRuTrends(mockClient({}), '/sub/acct', '1H', undefined, undefined);
        expect(result.available).toBe(false);
        expect(result.reason).toBe('noData');
    });

    it('tags a 403 RU trends failure as rbac', async () => {
        const result = await getRuTrends(throwingClient({ statusCode: 403 }), '/sub/acct', '1H', undefined, undefined);
        expect(result.available).toBe(false);
        expect(result.reason).toBe('rbac');
    });

    it('tags a 403 inventory-metrics failure as rbac', async () => {
        const result = await getInventoryMetrics(
            throwingClient({ statusCode: 403 }),
            '/sub/acct',
            '24H',
            'Succeeded',
            thresholds,
        );
        expect(result.available).toBe(false);
        expect(result.reason).toBe('rbac');
    });

    it('tags an empty partition-health result as noData', async () => {
        const result = await getPartitionHealth(
            mockClient({}),
            '/sub/acct',
            'ru',
            '1H',
            'db',
            'c1',
            partitionThresholds,
        );
        expect(result.available).toBe(false);
        expect(result.reason).toBe('noData');
    });

    it('tags a 403 partition-health failure as rbac', async () => {
        const result = await getPartitionHealth(
            throwingClient({ statusCode: 403 }),
            '/sub/acct',
            'ru',
            '1H',
            'db',
            'c1',
            partitionThresholds,
        );
        expect(result.available).toBe(false);
        expect(result.reason).toBe('rbac');
    });
});
