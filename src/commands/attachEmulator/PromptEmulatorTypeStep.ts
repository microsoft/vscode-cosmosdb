/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, openUrl, UserCancelledError } from '@microsoft/vscode-azext-utils';
import { QuickPickItemKind } from 'vscode';
import { API, CoreExperience, MongoExperience } from '../../AzureDBExperiences';
import { SettingsService } from '../../services/SettingsService';
import { AttachEmulatorMode, type AttachEmulatorWizardContext } from './AttachEmulatorWizardContext';

export class PromptEmulatorTypeStep extends AzureWizardPromptStep<AttachEmulatorWizardContext> {
    private readonly preselectedAPI: API;

    constructor(preselectedAPI: API) {
        super();
        this.preselectedAPI = preselectedAPI;
    }

    public async prompt(context: AttachEmulatorWizardContext): Promise<void> {
        const isCore = this.preselectedAPI === API.Core;

        const preconfiguredEmulators = isCore
            ? [
                  {
                      id: API.Core,
                      label: 'Azure Cosmos DB (NoSQL)',
                      detail: 'I want to connect to the Azure Cosmos DB (NoSQL) Emulator.',
                      alwaysShow: true,
                      group: 'Preconfigured Emulators',
                  },
              ]
            : [
                  {
                      id: API.MongoDB,
                      label: 'Azure Cosmos DB for MongoDB (RU)',
                      detail: 'I want to connect to the Azure Cosmos DB Emulator for MongoDB (RU).',
                      alwaysShow: true,
                      group: 'Preconfigured Emulators',
                  },
                  // Additional MongoDB emulator options can be added here
              ];

        const commonItems = [
            { label: '', kind: QuickPickItemKind.Separator },
            {
                id: 'connectionString',
                label: 'Connection String',
                detail: 'I want to connect using a connection string.',
                alwaysShow: true,
                group: 'Custom Emulators',
            },
            { label: '', kind: QuickPickItemKind.Separator },
            {
                id: 'learnMore',
                label: 'Learn more',
                detail: isCore
                    ? 'Learn more about the Azure Cosmos DB (NoSQL) Emulator.'
                    : 'Learn more about the Azure Cosmos DB Emulator for MongoDB.',
                learnMoreUrl: isCore
                    ? 'https://learn.microsoft.com/en-us/azure/cosmos-db/how-to-develop-emulator?pivots=api-nosql'
                    : 'https://learn.microsoft.com/en-us/azure/cosmos-db/how-to-develop-emulator?pivots=api-mongodb',
                alwaysShow: true,
                group: 'Learn More',
            },
        ];

        const selectedItem = await context.ui.showQuickPick([...preconfiguredEmulators, ...commonItems], {
            enableGrouping: true,
            placeHolder: isCore ? 'Select the Azure Cosmos DB Emulator Type...' : 'Select the MongoDB Emulator Type...',
            stepName: 'selectEmulatorType',
            suppressPersistence: true,
        });

        if (selectedItem.id === 'learnMore') {
            context.telemetry.properties.emulatorLearnMore = 'true';
            await openUrl(selectedItem.learnMoreUrl!);
            throw new UserCancelledError();
        }

        if (selectedItem.id === 'connectionString') {
            context.mode = AttachEmulatorMode.CustomConnectionString;
            context.experience = isCore ? CoreExperience : MongoExperience;
        }

        if (preconfiguredEmulators.some((emulator) => emulator.id === selectedItem.id)) {
            context.mode = AttachEmulatorMode.Preconfigured;
            context.experience = isCore ? CoreExperience : MongoExperience;
            const settingName = isCore ? 'cosmosDB.emulator.port' : 'cosmosDB.emulator.mongoPort';

            context.port =
                SettingsService.getWorkspaceSetting<number>(settingName) ??
                SettingsService.getGlobalSetting<number>(settingName);
        }
    }

    public shouldPrompt(): boolean {
        return true;
    }
}
