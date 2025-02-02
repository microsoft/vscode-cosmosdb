/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import { API, getExperienceQuickPick } from '../../AzureDBExperiences';
import { SettingsService } from '../../services/SettingsService';
import { type AttachEmulatorWizardContext } from './AttachEmulatorWizardContext';

export class PromptExperienceStep extends AzureWizardPromptStep<AttachEmulatorWizardContext> {
    public hideStepCount: boolean = false;

    public async prompt(context: AttachEmulatorWizardContext): Promise<void> {
        const defaultExperiencePick = await context.ui.showQuickPick(
            [getExperienceQuickPick(API.MongoDB), getExperienceQuickPick(API.Core)],
            {
                placeHolder: 'Select a Database Account API',
                stepName: 'attachEmulator',
            },
        );
        const experience = defaultExperiencePick.data;
        const settingName = experience.api === API.MongoDB ? 'cosmosDB.emulator.mongoPort' : 'cosmosDB.emulator.port';
        const port =
            SettingsService.getWorkspaceSetting<number>(settingName) ??
            SettingsService.getGlobalSetting<number>(settingName);

        context.telemetry.properties.experience = experience.api;
        context.experience = experience;
        context.port = port;
    }

    public shouldPrompt(context: AttachEmulatorWizardContext): boolean {
        return !context.experience;
    }
}
