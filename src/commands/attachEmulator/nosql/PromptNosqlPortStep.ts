/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import { wellKnownEmulatorPassword } from '../../../constants';
import { AttachEmulatorMode, type AttachEmulatorWizardContext } from '../AttachEmulatorWizardContext';

export class PromptNosqlPortStep extends AzureWizardPromptStep<AttachEmulatorWizardContext> {
    public hideStepCount: boolean = false;

    public async prompt(context: AttachEmulatorWizardContext): Promise<void> {
        const port = await context.ui.showInputBox({
            value: context.port ? context.port.toString() : '',
            prompt: 'Enter the port number for the Azure Cosmos DB Emulator',
            validateInput: (port: string) => this.validateInput(port),
        });

        if (port && context.experience) {
            context.port = Number(port);
            context.connectionString = this.buildConnectionString(Number(port));
        }
    }

    public shouldPrompt(context: AttachEmulatorWizardContext): boolean {
        return context.mode === AttachEmulatorMode.Preconfigured;
    }

    public validateInput(port: string | undefined): string | undefined {
        port = port ? port.trim() : '';

        if (!port) {
            return 'Port number is required';
        }

        const portNumber = parseInt(port, 10);
        if (isNaN(portNumber)) {
            return 'Port number must be a number';
        }

        if (portNumber <= 0 || portNumber > 65535) {
            return 'Port number must be between 1 and 65535';
        }

        return undefined;
    }

    private buildConnectionString(port: string | number): string {
        return `AccountEndpoint=https://localhost:${port}/;AccountKey=${wellKnownEmulatorPassword};`;
    }
}
