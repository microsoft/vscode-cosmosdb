/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { createBlankContainer } from '../webviews/cosmosdb/DataModeling/dataModel';
import { WizardStateSchema } from './modelingAdvisorSchema';

describe('wizard document size validation', () => {
    it.each(['avgSizeKb', 'maxSizeKb'] as const)('caps %s at the inclusive 2048 KB limit', (field) => {
        const container = createBlankContainer();
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
});
