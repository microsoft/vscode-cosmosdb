/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, UserCancelledError } from '@microsoft/vscode-azext-utils';
import { QuickPickItemKind } from 'vscode';
import { wellKnownEmulatorPassword } from '../../constants';
import { localize } from '../../utils/localize';
import { openUrl } from '../../utils/openUrl';
import { type AttachAccountWizardContext } from './AttachAccountWizardContext';

export class MongoEmulatorStep extends AzureWizardPromptStep<AttachAccountWizardContext> {
    public async prompt(context: AttachAccountWizardContext): Promise<void> {
        // Create a complex quick pick UI for emulator confirmation using VS Code's API
        const selecteditem = await context.ui.showQuickPick(
            [
                {
                    id: 'emulator',
                    label: '$(plug) Emulator',
                    description:
                        'I am connecting to the Azure Cosmos DB Emulator for MongoDB. Use emulator settings for this connection.',
                    alwaysShow: true,
                    group: 'Server Type',
                },
                {
                    id: 'standard',
                    label: '$(server-environment) Standard',
                    description: 'I am not connecting to an emulator. Proceed with standard connection settings.',
                    alwaysShow: true,
                    group: 'Server Type',
                },
                {
                    label: '',
                    kind: QuickPickItemKind.Separator,
                },
                {
                    id: 'learnMore',
                    label: '$(link-external) Learn more',
                    description: 'Learn more about the Azure Cosmos DB Emulator for MongoDB API',
                    alwaysShow: true,
                    group: 'Learn More',
                },
            ],
            {
                title: 'Emulator Connection Confirmation',
                placeHolder: localize('confirmUsingEmulator', 'Please confirm if you are connecting to an emulator'),
                enableGrouping: true,
                suppressPersistence: true, // the order of items will not be modified by past choices
            },
        );

        if (selecteditem.id === 'emulator') {
            context.mongodbapiIsEmulator = true;
        }

        if (selecteditem.id === 'learnMore') {
            context.telemetry.properties.emulatorLearnMore = 'true';

            await openUrl(
                'https://learn.microsoft.com/en-us/azure/cosmos-db/how-to-develop-emulator?pivots=api-mongodb',
            );
            throw new UserCancelledError();
        }
    }

    public shouldPrompt(context: AttachAccountWizardContext): boolean {
        // We'll prompt only when it looks like it's the Azure Cosmos DB Emulator for MongoDB API

        const urlDecodedConnectionString = decodeURIComponent(context.connectionString ?? '');
        return (
            !!context.connectionString &&
            context.connectionString.includes('mongodb://') &&
            (context.connectionString.includes(wellKnownEmulatorPassword) ||
                urlDecodedConnectionString.includes(wellKnownEmulatorPassword))
        );
    }
}
