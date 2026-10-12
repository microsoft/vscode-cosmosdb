/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_ADVISORY_THRESHOLDS, DIAGNOSTIC_POLICY } from '../core/thresholds';
import { AutoscaleCandidateDetector } from './AutoscaleCandidateDetector';

describe('autoscale observation label localization', () => {
    afterEach(() => l10n.config({ contents: {} }));

    it.each([
        { label: '7 days', translated: '7 Tage', manualThroughput: undefined },
        {
            label: '30 days',
            translated: '30 Tage',
            manualThroughput: [
                {
                    databaseId: 'db',
                    containerId: 'container',
                    provisionedRu: 1000,
                    ruPercents: Array<number>(DIAGNOSTIC_POLICY.overProvisioning.minSamples).fill(10),
                    peakPercent: 80,
                    resourceAgeDays: 30,
                },
            ],
        },
    ])('localizes the $label label inside the rationale', ({ label, translated, manualThroughput }) => {
        l10n.config({ contents: { [label]: translated } });
        const advisories = new AutoscaleCandidateDetector().run({
            inputs: {
                weeklyRuPercents: [10],
                weeklyPeakPercent: 80,
                hasManualThroughput: true,
                manualThroughput,
                partitions: [],
                storage: [],
                indexing: [],
            },
            thresholds: DEFAULT_ADVISORY_THRESHOLDS,
        });

        expect(advisories).toHaveLength(1);
        expect(advisories[0].rationale).toContain(translated);
        expect(advisories[0].rationale).not.toContain(label);
    });
});
