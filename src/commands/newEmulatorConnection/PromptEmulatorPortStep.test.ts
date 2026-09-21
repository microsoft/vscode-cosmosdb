/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';
import { CoreExperience } from '../../AzureDBExperiences';
import { type NewEmulatorConnectionWizardContext } from './NewEmulatorConnectionWizardContext';
import { PromptEmulatorPortStep } from './PromptEmulatorPortStep';

vi.mock('@microsoft/vscode-azext-utils', () => ({
    AzureWizardPromptStep: class {},
}));

const step = new PromptEmulatorPortStep();

describe('PromptEmulatorPortStep', () => {
    it.each(['1', '8081', '65535', ' 8081 '])('accepts the integer port %j', (port) => {
        expect(step.validateInput(port)).toBeUndefined();
    });

    it.each(['8081abc', '8081.5', '+8081', '-8081'])('rejects the malformed port %j', (port) => {
        expect(step.validateInput(port)).toBe('Port number must be an integer');
    });

    it.each(['0', '65536'])('rejects the out-of-range port %j', (port) => {
        expect(step.validateInput(port)).toBe('Port number must be between 1 and 65535');
    });

    it.each(['', '   ', undefined])('requires a port for %j', (port) => {
        expect(step.validateInput(port)).toBe('Port number is required');
    });

    it('normalizes the port used by the context and connection string', async () => {
        const context = {
            experience: CoreExperience,
            ui: { showInputBox: vi.fn().mockResolvedValue(' 8081 ') },
        } as unknown as NewEmulatorConnectionWizardContext;

        await step.prompt(context);

        expect(context.port).toBe(8081);
        expect(context.connectionString).toContain('AccountEndpoint=https://localhost:8081/;');
    });
});
