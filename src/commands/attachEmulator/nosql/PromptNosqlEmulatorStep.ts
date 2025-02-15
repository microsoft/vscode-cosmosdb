/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, openUrl, UserCancelledError } from '@microsoft/vscode-azext-utils';
import { QuickPickItemKind } from 'vscode';
import { API, CoreExperience } from '../../../AzureDBExperiences';
import { SettingsService } from '../../../services/SettingsService';
import { AttachEmulatorMode, type AttachEmulatorWizardContext } from '../AttachEmulatorWizardContext';

export class PromptNosqlEmulatorStep extends AzureWizardPromptStep<AttachEmulatorWizardContext> {
    public async prompt(context: AttachEmulatorWizardContext): Promise<void> {
        const selectedItem = await context.ui.showQuickPick(
            [
                {
                    id: API.Core,
                    label: 'Azure Cosmos DB (NoSQL)',
                    detail: 'I want to connect to the Azure Cosmos DB (NoSQL) Emulator',
                    alwaysShow: true,
                    group: 'Preconfigured Emulators',
                },
                {
                    label: '',
                    kind: QuickPickItemKind.Separator,
                },
                {
                    id: 'connectionString',
                    label: 'Connection String',
                    detail: 'I want to connect using a connection string.',
                    alwaysShow: true,
                    group: 'Custom Emulators',
                },
                {
                    label: '',
                    kind: QuickPickItemKind.Separator,
                },
                {
                    id: 'learnMore',
                    label: 'Learn more',
                    detail: 'Learn more about the Azure Cosmos DB (NoSQL) Emulator',
                    alwaysShow: true,
                    group: 'Learn More',
                },
            ],
            {
                enableGrouping: true,
                placeHolder: 'Select the Azure Cosmos DB Emulator Type...',
                stepName: 'selectNosqlEmulatorType',
                suppressPersistence: true, // == the order of items will not be altered
            },
        );

        if (selectedItem.id === 'learnMore') {
            context.telemetry.properties.emulatorLearnMore = 'true';

            await openUrl('https://learn.microsoft.com/en-us/azure/cosmos-db/how-to-develop-emulator?pivots=api-nosql');
            throw new UserCancelledError();
        }

        if (selectedItem.id === API.Core) {
            context.mode = AttachEmulatorMode.Preconfigured;

            context.experience = CoreExperience;

            const settingName = 'cosmosDB.emulator.port';
            const port =
                SettingsService.getWorkspaceSetting<number>(settingName) ??
                SettingsService.getGlobalSetting<number>(settingName);

            context.port = port;
        }

        if (selectedItem.id === 'connectionString') {
            context.mode = AttachEmulatorMode.CustomConnectionString;
            // it's a nosql emulator
            context.experience = CoreExperience;
        }
    }

    public shouldPrompt(): boolean {
        return true;
    }
}
