/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { createBlankContainer } from '../webviews/cosmosdb/DataModeling/dataModel';
import { ModelingAdvisorSnapshotSchema, WizardStateSchema } from './modelingAdvisorSchema';

describe('wizard document size validation', () => {
    it.each(['avgSizeKb', 'maxSizeKb'] as const)('rejects negative %s in requests and saved snapshots', (field) => {
        const container = createBlankContainer();
        const wizard = {
            step: 1,
            dataModel: { containers: [container], activeContainerId: container.id },
        };
        for (const value of [-1, -0.01]) {
            container.document[field] = value;
            const result = WizardStateSchema.safeParse(wizard);
            expect(result.success).toBe(false);
            expect(result.error?.issues).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ path: ['dataModel', 'containers', 0, 'document', field] }),
                ]),
            );
            const snapshot = ModelingAdvisorSnapshotSchema.safeParse({ wizard, recommendation: { status: 'idle' } });
            expect(snapshot.success).toBe(false);
            expect(snapshot.error?.issues[0].path).toEqual(['wizard', 'dataModel', 'containers', 0, 'document', field]);
        }
    });

    it.each(['avgSizeKb', 'maxSizeKb'] as const)('caps %s at the inclusive 2048 KB limit', (field) => {
        const container = createBlankContainer();
        container.document.avgSizeKb = 0;
        container.document.maxSizeKb = 2048;
        const wizard = {
            step: 1,
            dataModel: { containers: [container], activeContainerId: container.id },
        };
        const parsedSize = (value: number) => {
            container.document[field] = value;
            return WizardStateSchema.parse(wizard).dataModel.containers[0].document[field];
        };
        for (const value of [0, 1.5, 2047.99, 2048]) {
            expect(parsedSize(value)).toBe(value);
        }
        for (const value of [2048.01, 2049, 49999]) {
            expect(parsedSize(value)).toBe(2048);
        }
        for (const value of [Infinity, NaN]) {
            container.document[field] = value;
            const result = WizardStateSchema.safeParse(wizard);
            expect(result.success).toBe(false);
            expect(result.error?.issues[0].path).toEqual(['dataModel', 'containers', 0, 'document', field]);
        }
    });

    it.each([
        { average: 1, maximum: 4, valid: true },
        { average: 4, maximum: 4, valid: true },
        { average: 0, maximum: 0, valid: true },
        { average: 2048, maximum: 2048, valid: true },
        { average: 4.01, maximum: 4, valid: false },
        { average: 2048, maximum: 28, valid: false },
    ])('validates average $average against maximum $maximum', ({ average, maximum, valid }) => {
        const container = createBlankContainer();
        container.document.avgSizeKb = average;
        container.document.maxSizeKb = maximum;
        const wizard = { step: 1, dataModel: { containers: [container], activeContainerId: container.id } };
        const result = WizardStateSchema.safeParse(wizard);
        expect(result.success).toBe(valid);
        expect(result.error?.issues[0].path).toEqual(
            valid ? undefined : ['dataModel', 'containers', 0, 'document', 'avgSizeKb'],
        );
        expect(ModelingAdvisorSnapshotSchema.parse({ wizard, recommendation: { status: 'idle' } }).wizard).toEqual(
            wizard,
        );
    });

    it('rejects inconsistent estimates in inactive containers too', () => {
        const first = createBlankContainer('First');
        const second = createBlankContainer('Second');
        second.document.avgSizeKb = 8;
        const result = WizardStateSchema.safeParse({
            step: 1,
            dataModel: { containers: [first, second], activeContainerId: first.id },
        });
        expect(result.success).toBe(false);
        expect(result.error?.issues[0].path).toEqual(['dataModel', 'containers', 1, 'document', 'avgSizeKb']);
    });
});
