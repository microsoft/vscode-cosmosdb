/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import { MongoExperience, type Experience } from '../../AzureDBExperiences';
import { wellKnownEmulatorPassword } from '../../constants';
import {
    NewEmulatorConnectionMode,
    type NewEmulatorConnectionWizardContext,
} from './NewEmulatorConnectionWizardContext';

export class PromptEmulatorPortStep extends AzureWizardPromptStep<NewEmulatorConnectionWizardContext> {
    public hideStepCount: boolean = false;

    public async prompt(context: NewEmulatorConnectionWizardContext): Promise<void> {
        let defaultPort: string;
        let promptText: string;
        let placeHolder: string | undefined;

        switch (context.experience) {
            case MongoExperience:
                defaultPort = context.port ? context.port.toString() : '10255';
                promptText = 'Enter the port number of the Emulator';
                placeHolder = 'The default port: 10255';
                break;
            default:
                defaultPort = context.port ? context.port.toString() : '8081';
                placeHolder = 'The default port: 8081';
                promptText = 'Enter the port number for the Azure Cosmos DB Emulator';
                break;
        }

        const port = await context.ui.showInputBox({
            prompt: promptText,
            value: defaultPort,
            placeHolder: placeHolder,
            validateInput: (input: string) => this.validateInput(input),
        });

        if (port && context.experience) {
            context.port = Number(port);
            context.connectionString = this.buildConnectionString(Number(port), context.experience);
        }
    }

    public shouldPrompt(context: NewEmulatorConnectionWizardContext): boolean {
        // For Mongo and NoSQL, prompt if mode is Preconfigured
        return context.mode === NewEmulatorConnectionMode.Preconfigured;
    }

    private validateInput(port: string | undefined): string | undefined {
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

    private buildConnectionString(port: number, experience: Experience): string | undefined {
        switch (experience) {
            case MongoExperience:
                return `mongodb://localhost:${encodeURIComponent(wellKnownEmulatorPassword)}@localhost:${port}/?ssl=true&retrywrites=false`;
            default:
                return `AccountEndpoint=https://localhost:${port}/;AccountKey=${wellKnownEmulatorPassword};`;
        }
    }
}
