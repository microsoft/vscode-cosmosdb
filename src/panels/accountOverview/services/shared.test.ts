/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { DEFAULT_HEALTH_THRESHOLDS, getInventoryMetrics, type HealthThresholds } from './inventoryMetrics';
import { DEFAULT_PARTITION_THRESHOLDS, getPartitionHealth } from './partitionHealth';
import { getRuTrends } from './ruTrends';
import { classifyUnavailable } from './shared';
import { mockClient, throwingClient } from './testFixtures';

const thresholds: HealthThresholds = DEFAULT_HEALTH_THRESHOLDS;

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
