/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';

// validateInput is pure; stub the wizard base and the heavy data-plane imports the
// module pulls in at load time so we can instantiate the step in isolation.
vi.mock('@microsoft/vscode-azext-utils', () => ({
    AzureWizardPromptStep: class {},
    parseError: (e: unknown) => ({ message: String(e) }),
}));
vi.mock('../../cosmosdb/withClaimsChallengeHandling', () => ({
    withClaimsChallengeHandling: vi.fn(),
}));
vi.mock('../../extensionVariables', () => ({
    ext: { outputChannel: { appendLine: vi.fn() } },
}));

import { CosmosDBContainerNameStep } from './CosmosDBContainerNameStep';

function validate(name: string | undefined): string | undefined {
    return new CosmosDBContainerNameStep().validateInput(name);
}

describe('CosmosDBContainerNameStep.validateInput', () => {
    it('accepts a normal container name', () => {
        expect(validate('my-container')).toBeUndefined();
    });

    it('treats empty / whitespace-only input as valid here (async task handles required)', () => {
        expect(validate('')).toBeUndefined();
        expect(validate('   ')).toBeUndefined();
        expect(validate(undefined)).toBeUndefined();
    });

    it.each(['/', '\\', '?', '#'])('rejects the illegal character %j', (char) => {
        expect(validate(`c${char}name`)).toBe("Container name cannot contain the characters '\\', '/', '#', '?'");
    });

    it("allows '=' in container names (unlike database names)", () => {
        expect(validate('container=name')).toBeUndefined();
    });

    it('rejects names longer than 255 characters', () => {
        expect(validate('a'.repeat(256))).toBe('Container name cannot be longer than 255 characters');
    });

    it('accepts a name of exactly 255 characters', () => {
        expect(validate('a'.repeat(255))).toBeUndefined();
    });
});
