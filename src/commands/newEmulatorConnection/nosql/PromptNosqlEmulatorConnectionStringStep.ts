/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import { parseDocDBConnectionString } from '../../../docdb/docDBConnectionStrings';
import {
    NewEmulatorConnectionMode,
    type NewEmulatorConnectionWizardContext,
} from '../NewEmulatorConnectionWizardContext';

// TODO: create one that can be shared for adding an account and adding an emulator
export class PromptNosqlEmulatorConnectionStringStep extends AzureWizardPromptStep<NewEmulatorConnectionWizardContext> {
    public async prompt(context: NewEmulatorConnectionWizardContext): Promise<void> {
        context.connectionString = (
            await context.ui.showInputBox({
                prompt: 'Enter the connection string of your Emulator',
                ignoreFocusOut: true,
                placeHolder: 'AccountEndpoint=...;AccountKey=...',
                validateInput: (connectionString?: string) => this.validateInput(connectionString),
                asyncValidationTask: (connectionString: string) => this.validateConnectionString(connectionString),
            })
        ).trim();

        context.port = extractPortFromConnectionString(context.connectionString);

        context.valuesToMask.push(context.connectionString);
    }

    //eslint-disable-next-line @typescript-eslint/require-await
    private async validateConnectionString(connectionString: string): Promise<string | null | undefined> {
        try {
            parseDocDBConnectionString(connectionString);
        } catch (error) {
            if (error instanceof Error) {
                return error.message;
            } else {
                return 'Connection string must be of the form "AccountEndpoint=...;AccountKey=..."';
            }
        }

        return undefined;
    }

    public shouldPrompt(context: NewEmulatorConnectionWizardContext): boolean {
        return context.mode === NewEmulatorConnectionMode.CustomConnectionString;
    }

    public validateInput(this: void, connectionString: string | undefined): string | undefined {
        connectionString = connectionString ? connectionString.trim() : '';

        if (connectionString.length === 0) {
            // skip this for now, asyncValidationTask takes care of this case, otherwise it's only warnings the user sees..
            return undefined;
        }

        return undefined;
    }
}

function extractPortFromConnectionString(connectionString: string): number | undefined {
    try {
        const parsedConnectionString = parseDocDBConnectionString(connectionString);
        if (!parsedConnectionString.port) {
            return undefined;
        }

        const portNumber = Number(parsedConnectionString.port);
        if (isNaN(portNumber)) {
            return undefined;
        }

        return portNumber;
    } catch {
        return undefined;
    }
}
