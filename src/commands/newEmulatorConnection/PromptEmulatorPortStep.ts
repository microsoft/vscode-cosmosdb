/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { wellKnownEmulatorPassword } from '../../constants';
import {
    NewEmulatorConnectionMode,
    type NewEmulatorConnectionWizardContext,
} from './NewEmulatorConnectionWizardContext';

export class PromptEmulatorPortStep extends AzureWizardPromptStep<NewEmulatorConnectionWizardContext> {
    public hideStepCount: boolean = false;

    public async prompt(context: NewEmulatorConnectionWizardContext): Promise<void> {
        const defaultPort = context.port ? context.port.toString() : '8081';
        const placeHolder = l10n.t('The default port: 8081');
        const promptText = l10n.t('Enter the port number for the Azure Cosmos DB Emulator');

        const port = await context.ui.showInputBox({
            prompt: promptText,
            value: defaultPort,
            placeHolder: placeHolder,
            validateInput: (input: string) => this.validateInput(input),
        });

        if (port && context.experience) {
            context.port = Number(port);
            context.connectionString = `AccountEndpoint=https://localhost:${port}/;AccountKey=${wellKnownEmulatorPassword};`;
        }
    }

    public shouldPrompt(context: NewEmulatorConnectionWizardContext): boolean {
        // For NoSQL, prompt if mode is Preconfigured
        return context.mode === NewEmulatorConnectionMode.Preconfigured;
    }

    private validateInput(port: string | undefined): string | undefined {
        port = port ? port.trim() : '';

        if (!port) {
            return l10n.t('Port number is required');
        }

        const portNumber = parseInt(port, 10);
        if (isNaN(portNumber)) {
            return l10n.t('Port number must be a number');
        }

        if (portNumber <= 0 || portNumber > 65535) {
            return l10n.t('Port number must be between 1 and 65535');
        }

        return undefined;
    }
}
