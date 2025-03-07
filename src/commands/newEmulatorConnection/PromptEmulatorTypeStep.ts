/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, openUrl, UserCancelledError } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { API, CoreExperience, MongoExperience } from '../../AzureDBExperiences';
import { SettingsService } from '../../services/SettingsService';
import { defaultMongoEmulatorConfiguration } from '../../utils/mongoEmulatorConfiguration';
import {
    NewEmulatorConnectionMode,
    type NewEmulatorConnectionWizardContext,
} from './NewEmulatorConnectionWizardContext';

export class PromptEmulatorTypeStep extends AzureWizardPromptStep<NewEmulatorConnectionWizardContext> {
    private readonly preselectedAPI: API;

    constructor(preselectedAPI: API) {
        super();
        this.preselectedAPI = preselectedAPI;
    }

    public async prompt(context: NewEmulatorConnectionWizardContext): Promise<void> {
        const isCore = this.preselectedAPI === API.Core;

        const preconfiguredEmulators = isCore
            ? [
                  {
                      id: API.Core,
                      label: 'Azure Cosmos DB (NoSQL)',
                      detail: vscode.l10n.t('I want to connect to the Azure Cosmos DB (NoSQL) Emulator.'),
                      alwaysShow: true,
                      group: 'Preconfigured Emulators',
                  },
              ]
            : [
                  {
                      id: API.MongoDB,
                      label: vscode.l10n.t('Azure Cosmos DB for MongoDB (RU)'),
                      detail: vscode.l10n.t('I want to connect to the Azure Cosmos DB Emulator for MongoDB (RU).'),
                      alwaysShow: true,
                      group: 'Preconfigured Emulators',
                  },
                  // Additional MongoDB emulator options can be added here
              ];

        const commonItems = [
            { label: '', kind: vscode.QuickPickItemKind.Separator },
            {
                id: 'connectionString',
                label: vscode.l10n.t('Connection String'),
                detail: vscode.l10n.t('I want to connect using a connection string.'),
                alwaysShow: true,
                group: 'Custom Emulators',
            },
            { label: '', kind: vscode.QuickPickItemKind.Separator },
            {
                id: 'learnMore',
                label: vscode.l10n.t('Learn more'),
                detail: isCore
                    ? vscode.l10n.t('Learn more about the Azure Cosmos DB (NoSQL) Emulator.')
                    : vscode.l10n.t('Learn more about the Azure Cosmos DB Emulator for MongoDB.'),
                learnMoreUrl: isCore
                    ? 'https://learn.microsoft.com/en-us/azure/cosmos-db/how-to-develop-emulator?pivots=api-nosql'
                    : 'https://learn.microsoft.com/en-us/azure/cosmos-db/how-to-develop-emulator?pivots=api-mongodb',
                alwaysShow: true,
                group: 'Learn More',
            },
        ];

        const selectedItem = await context.ui.showQuickPick([...preconfiguredEmulators, ...commonItems], {
            enableGrouping: true,
            placeHolder: isCore
                ? vscode.l10n.t('Select the Azure Cosmos DB Emulator Type...')
                : vscode.l10n.t('Select the MongoDB Emulator Type...'),
            stepName: 'selectEmulatorType',
            suppressPersistence: true,
        });

        if (selectedItem.id === 'learnMore') {
            context.telemetry.properties.emulatorLearnMore = 'true';
            await openUrl(selectedItem.learnMoreUrl!);
            throw new UserCancelledError();
        }

        if (selectedItem.id === 'connectionString') {
            context.mode = NewEmulatorConnectionMode.CustomConnectionString;
            context.experience = isCore ? CoreExperience : MongoExperience;

            if (isCore) {
                context.isCoreEmulator = true;
            } else {
                context.mongoEmulatorConfiguration = defaultMongoEmulatorConfiguration;
            }

            return;
        }

        if (preconfiguredEmulators.some((emulator) => emulator.id === selectedItem.id)) {
            context.mode = NewEmulatorConnectionMode.Preconfigured;
            context.experience = isCore ? CoreExperience : MongoExperience;

            if (isCore) {
                context.isCoreEmulator = true;
            } else {
                context.mongoEmulatorConfiguration = defaultMongoEmulatorConfiguration;
            }

            const settingName = isCore ? 'cosmosDB.emulator.port' : 'cosmosDB.emulator.mongoPort';

            context.port =
                SettingsService.getWorkspaceSetting<number>(settingName) ??
                SettingsService.getGlobalSetting<number>(settingName);
            return;
        }
    }

    public shouldPrompt(): boolean {
        return true;
    }
}
