/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';

vi.mock('@microsoft/vscode-azext-utils', () => ({
    AzureWizardPromptStep: class {},
}));

import { CosmosDBPartitionKeyStep } from './CosmosDBPartitionKeyStep';
import { type CreateContainerWizardContext } from './CreateContainerWizardContext';

const step = new CosmosDBPartitionKeyStep('first');

describe('CosmosDBPartitionKeyStep', () => {
    it.each(['/TenantId', 'TenantId', '/address/zipCode', 'address/zipCode', '/a/b/c', ' /address/zipCode '])(
        'accepts the partition key path %j',
        (path) => {
            expect(step.validateInput(path)).toBeUndefined();
        },
    );

    it.each(['/', '//address', '/address//zipCode', '/address/', 'address//zipCode'])(
        'rejects empty segments in %j',
        (path) => {
            expect(step.validateInput(path)).toBeDefined();
        },
    );

    it.each(['address.zipCode', '/address/zip-code', '/address/zip code', '/address\\zipCode'])(
        'retains the existing character restrictions for %j',
        (path) => {
            expect(step.validateInput(path)).toBeDefined();
        },
    );

    it.each(['', '   ', undefined])('leaves required-input validation to the asynchronous check for %j', (path) => {
        expect(step.validateInput(path)).toBeUndefined();
    });

    it('retains the maximum path length', () => {
        expect(step.validateInput('/' + 'a'.repeat(252) + '/b')).toBeUndefined();
        expect(step.validateInput('/' + 'a'.repeat(253) + '/b')).toBe(
            'Partition key cannot be longer than 255 characters',
        );
    });

    it.each(['/address/zipCode', 'address/zipCode'])(
        'stores and masks a nested path from the prompt for %j',
        async (path) => {
            const context = {
                partitionKey: { paths: ['/TenantId'] },
                ui: { showInputBox: vi.fn().mockResolvedValue(path) },
                valuesToMask: [],
            } as unknown as CreateContainerWizardContext;

            await new CosmosDBPartitionKeyStep('second').prompt(context);

            expect(context.partitionKey?.paths).toEqual(['/TenantId', '/address/zipCode']);
            expect(context.valuesToMask).toEqual(['/address/zipCode', 'address/zipCode']);
        },
    );
});
