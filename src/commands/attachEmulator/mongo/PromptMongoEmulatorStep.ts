/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, openUrl, UserCancelledError } from '@microsoft/vscode-azext-utils';
import { QuickPickItemKind } from 'vscode';
import { API, MongoExperience } from '../../../AzureDBExperiences';
import { SettingsService } from '../../../services/SettingsService';
import { type AttachEmulatorWizardContext } from '../AttachEmulatorWizardContext';

export class PromptMongoEmulatorStep extends AzureWizardPromptStep<AttachEmulatorWizardContext> {
    public async prompt(context: AttachEmulatorWizardContext): Promise<void> {
        const selectedItem = await context.ui.showQuickPick(
            [
                {
                    id: API.MongoDB,
                    label: '$(plug) Azure Cosmos DB for MongoDB (RU)',
                    detail: 'I want to connect to the Azure Cosmos DB Emulator for MongoDB (RU). Use emulator settings for this connection.',
                    alwaysShow: true,
                    group: 'Emulator Type',
                },
                {
                    label: '',
                    kind: QuickPickItemKind.Separator,
                },
                {
                    id: 'learnMore',
                    label: 'Learn more',
                    detail: 'Learn more about the Azure Cosmos DB Emulator for MongoDB',
                    alwaysShow: true,
                    group: 'Learn More',
                },
            ],
            {
                enableGrouping: true,
                placeHolder: 'Select the MongoDB Emulator Type...',
                stepName: 'selectMongoEmulatorType',
                suppressPersistence: true, // == the order of items will not be altered
            },
        );

        if (selectedItem.id === 'learnMore') {
            context.telemetry.properties.emulatorLearnMore = 'true';

            await openUrl(
                'https://learn.microsoft.com/en-us/azure/cosmos-db/how-to-develop-emulator?pivots=api-mongodb',
            );
            throw new UserCancelledError();
        }

        if (selectedItem.id === API.MongoDB) {
            context.experience = MongoExperience;

            const settingName = 'cosmosDB.emulator.mongoPort';
            const port =
                SettingsService.getWorkspaceSetting<number>(settingName) ??
                SettingsService.getGlobalSetting<number>(settingName);

            context.port = port;
        }
    }

    public shouldPrompt(): boolean {
        return true;
    }
}
