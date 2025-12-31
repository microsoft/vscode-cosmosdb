/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, openUrl, UserCancelledError } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { API, CoreExperience } from '../../AzureDBExperiences';
import { SettingsService } from '../../services/SettingsService';
import {
    NewEmulatorConnectionMode,
    type NewEmulatorConnectionWizardContext,
} from './NewEmulatorConnectionWizardContext';

export class PromptEmulatorTypeStep extends AzureWizardPromptStep<NewEmulatorConnectionWizardContext> {
    constructor() {
        super();
    }

    public async prompt(context: NewEmulatorConnectionWizardContext): Promise<void> {
        const preconfiguredEmulators = [
            {
                id: API.Core,
                label: l10n.t('Azure Cosmos DB (NoSQL)'),
                detail: l10n.t('I want to connect to the Azure Cosmos DB (NoSQL) Emulator.'),
                alwaysShow: true,
                group: 'Preconfigured Emulators',
            },
        ];

        const commonItems = [
            { label: '', kind: vscode.QuickPickItemKind.Separator },
            {
                id: 'connectionString',
                label: l10n.t('Connection String'),
                detail: l10n.t('I want to connect using a connection string.'),
                alwaysShow: true,
                group: 'Custom Emulators',
            },
            { label: '', kind: vscode.QuickPickItemKind.Separator },
            {
                id: 'learnMore',
                label: l10n.t('Learn more…'),
                detail: l10n.t('Learn more about the Azure Cosmos DB (NoSQL) Emulator.'),
                learnMoreUrl:
                    'https://learn.microsoft.com/en-us/azure/cosmos-db/how-to-develop-emulator?pivots=api-nosql',
                alwaysShow: true,
                group: 'Learn More',
            },
        ];

        const selectedItem = await context.ui.showQuickPick([...preconfiguredEmulators, ...commonItems], {
            enableGrouping: true,
            placeHolder: l10n.t('Select the Azure Cosmos DB Emulator Type…'),
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
            context.experience = CoreExperience;

            return;
        }

        if (preconfiguredEmulators.some((emulator) => emulator.id === selectedItem.id)) {
            context.mode = NewEmulatorConnectionMode.Preconfigured;
            context.experience = CoreExperience;

            const settingName = 'cosmosDB.emulator.port';

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
