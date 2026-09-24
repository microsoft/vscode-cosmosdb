/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { getAccountConfiguration } from './accountConfiguration';

describe('account overview configuration', () => {
    it('does not invent defaults for absent ARM properties', () => {
        expect(getAccountConfiguration({})).toEqual({
            automaticFailoverEnabled: undefined,
            backupRetentionHours: undefined,
            backupIntervalMinutes: undefined,
            continuousBackupTier: undefined,
        });
    });

    it('reads explicit periodic retention, interval and disabled failover', () => {
        expect(
            getAccountConfiguration({
                enableAutomaticFailover: false,
                backupPolicy: {
                    type: 'Periodic',
                    periodicModeProperties: { backupRetentionIntervalInHours: 16, backupIntervalInMinutes: 120 },
                },
            }),
        ).toEqual({
            automaticFailoverEnabled: false,
            backupRetentionHours: 16,
            backupIntervalMinutes: 120,
            continuousBackupTier: undefined,
        });
    });

    it.each([
        ['Continuous7Days', 168],
        ['Continuous30Days', 720],
        ['futureTier', undefined],
    ] as const)('derives retention only from known continuous tier %s', (tier, hours) => {
        expect(
            getAccountConfiguration({
                backupPolicy: { type: 'Continuous', continuousModeProperties: { tier } },
            }).backupRetentionHours,
        ).toBe(hours);
    });
});
