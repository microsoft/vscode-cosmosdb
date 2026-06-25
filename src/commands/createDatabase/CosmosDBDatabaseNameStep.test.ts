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

import { CosmosDBDatabaseNameStep } from './CosmosDBDatabaseNameStep';

function validate(name: string | undefined): string | undefined {
    return new CosmosDBDatabaseNameStep().validateInput(name);
}

describe('CosmosDBDatabaseNameStep.validateInput', () => {
    it('accepts a normal database name', () => {
        expect(validate('my-database')).toBeUndefined();
    });

    it('treats empty / whitespace-only input as valid here (async task handles required)', () => {
        expect(validate('')).toBeUndefined();
        expect(validate('   ')).toBeUndefined();
        expect(validate(undefined)).toBeUndefined();
    });

    it.each(['/', '\\', '?', '#', '='])('rejects the illegal character %j', (char) => {
        expect(validate(`db${char}name`)).toBe("Database name cannot contain the characters '\\', '/', '#', '?', '='");
    });

    it('rejects names longer than 255 characters', () => {
        expect(validate('a'.repeat(256))).toBe('Database name cannot be longer than 255 characters');
    });

    it('accepts a name of exactly 255 characters', () => {
        expect(validate('a'.repeat(255))).toBeUndefined();
    });

    it('trims surrounding whitespace before validating length', () => {
        expect(validate(`  ${'a'.repeat(255)}  `)).toBeUndefined();
    });
});
