/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import { API, MongoExperience } from '../../../AzureDBExperiences';
import { wellKnownEmulatorPassword } from '../../../constants';
import { AttachEmulatorMode, type AttachEmulatorWizardContext } from '../AttachEmulatorWizardContext';

// TODO: temporary in a separate class, will be merged with PromptPortStep once we agree on the final design
export class PromptMongoPortStep extends AzureWizardPromptStep<AttachEmulatorWizardContext> {
    public hideStepCount: boolean = false;

    public async prompt(context: AttachEmulatorWizardContext): Promise<void> {
        const port = await context.ui.showInputBox({
            prompt: 'Enter the port number of the Emulator',
            value: context.port ? context.port.toString() : '10255',
            placeHolder: 'The default port: 10255',
            validateInput: (port: string) => this.validateInput(port),
        });

        if (port && context.experience) {
            context.port = Number(port);
            context.connectionString = this.buildConnectionString(Number(port), context.experience.api);
        }
    }

    public shouldPrompt(context: AttachEmulatorWizardContext): boolean {
        // only prompt for the RU emulator
        return context.mode === AttachEmulatorMode.Preconfigured && context.experience === MongoExperience;
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

    private buildConnectionString(port: string | number, experience: API): string | undefined {
        switch (experience) {
            case API.MongoDB:
                return `mongodb://localhost:${encodeURIComponent(wellKnownEmulatorPassword)}@localhost:${port}/?ssl=true&retrywrites=false`;
            default:
                return undefined;
        }
    }
}
