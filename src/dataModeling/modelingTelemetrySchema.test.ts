/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { getScenarioList } from '../webviews/cosmosdb/DataModeling/scenarios';
import { ModelingTelemetryEventSchema, ModelingUsageSchema } from './modelingTelemetrySchema';

describe('modeling telemetry bridge', () => {
    it.each([
        { type: 'feedback', vote: 'up', text: 'private feedback' },
        { type: 'step', step: 'container:secret-name' },
        { type: 'action', action: 'copyCode', method: 'private-method' },
        { type: 'action', action: 'copyCode', template: 'private code' },
        { type: 'recommendationClientFailure', errorCategory: 'private error' },
        { type: 'sessionChoice', choice: 'private choice' },
        { type: 'recommendationDisplayed', requestId: 'account-derived-id' },
        { type: 'control', control: 'private-label' },
        { type: 'control', control: 'footerStart', containerName: 'private-container' },
        { type: 'schemaImport', outcome: 'success', fileName: 'private-file.json' },
        { type: 'fieldAdded', name: 'private-field' },
        { type: 'scenarioSelected', scenario: 'none' },
        { type: 'scenarioSelected', scenario: 'private-workload' },
        { type: 'scenarioSelected', scenario: 'chat', filter: 'private-filter' },
    ])('rejects non-allowlisted telemetry: $type', (event) => {
        expect(ModelingTelemetryEventSchema.safeParse(event).success).toBe(false);
    });

    it.each(getScenarioList())('accepts the built-in workload $id without recording its label', ({ id }) => {
        const selection = { type: 'scenarioSelected', scenario: id };
        expect(ModelingTelemetryEventSchema.parse(selection)).toEqual(selection);
    });

    it.each([NaN, Infinity, -Infinity, -0.01, 1.01])('rejects invalid coverage %s', (coverage) => {
        expect(ModelingUsageSchema.shape.dataCoverage.safeParse(coverage).success).toBe(false);
    });

    it.each([0, 0.333, 1])('accepts valid coverage %s', (coverage) => {
        expect(ModelingUsageSchema.shape.dataCoverage.safeParse(coverage).success).toBe(true);
    });

    it.each([-1, 0.5, 11, Infinity, NaN])('rejects invalid container counts %s', (count) => {
        expect(ModelingUsageSchema.shape.containerCount.safeParse(count).success).toBe(false);
    });
});
