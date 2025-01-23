/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, nonNullValue, parseError } from '@microsoft/vscode-azext-utils';
import { API } from '../../AzureDBExperiences';
import { emulatorPassword } from '../../constants';
import { ext } from '../../extensionVariables';
import { WorkspaceResourceType } from '../../tree/workspace/SharedWorkspaceResourceProvider';
import { SharedWorkspaceStorage } from '../../tree/workspace/SharedWorkspaceStorage';
import { type AttachEmulatorWizardContext } from './AttachEmulatorWizardContext';

export class PromptPortStep extends AzureWizardPromptStep<AttachEmulatorWizardContext> {
    public hideStepCount: boolean = false;

    public async prompt(context: AttachEmulatorWizardContext): Promise<void> {
        const port = await context.ui.showInputBox({
            value: context.port ? context.port.toString() : '',
            prompt: 'Enter the port number for the Azure Cosmos DB Emulator',
            validateInput: (port: string) => this.validateInput(port),
            asyncValidationTask: (port: string) => this.validateNameAvailable(context, port),
        });

        if (port && context.experience) {
            context.port = Number(port);
            context.connectionString = this.buildConnectionString(Number(port), context.experience.api);
        }
    }

    public shouldPrompt(_context: AttachEmulatorWizardContext): boolean {
        return true;
    }

    public validateInput(port: string | undefined): string | undefined {
        port = port ? port.trim() : '';

        try {
            const portNumber = parseInt(port, 10);

            if (portNumber <= 0 || portNumber > 65535) {
                return 'Port number must be between 1 and 65535';
            }
        } catch {
            return 'Input must be a number';
        }

        return undefined;
    }

    private async validateNameAvailable(
        context: AttachEmulatorWizardContext,
        port: string,
    ): Promise<string | undefined> {
        if (port.length === 0) {
            return 'Port is required.';
        }

        if (context.experience === undefined) {
            return 'API is required.';
        }

        try {
            const items = await SharedWorkspaceStorage.getItems(WorkspaceResourceType.AttachedAccounts);
            const api = context.experience.api;
            const connectionString = this.buildConnectionString(Number(port), api);

            if (
                items.some((item) => {
                    const { properties, secrets } = item;
                    const itemApi: API = nonNullValue(properties?.api, 'api') as API;
                    const isEmulator: boolean = !!nonNullValue(properties?.isEmulator, 'isEmulator');
                    const itemConnectionString: string = nonNullValue(secrets?.[0], 'connectionString');

                    return isEmulator && itemApi === api && itemConnectionString === connectionString;
                })
            ) {
                // Need to set the port to undefined so that the user is prompted again
                context.port = undefined;
                return `The port "${port}" is already in use by another emulator.`;
            }
        } catch (error) {
            ext.outputChannel.appendLine(`Failed to validate port: ${parseError(error).message}`);
            return undefined; // we don't want to block the user from continuing if we can't validate the name
        }

        return undefined;
    }

    private buildConnectionString(port: string | number, experience: API): string {
        return experience === API.MongoDB
            ? `mongodb://localhost:${encodeURIComponent(emulatorPassword)}@localhost:${port}/?ssl=true`
            : `AccountEndpoint=https://localhost:${port}/;AccountKey=${emulatorPassword};`;
    }
}
