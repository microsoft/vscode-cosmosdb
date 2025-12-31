/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ExecuteActivityContext } from '@microsoft/vscode-azext-utils';
import { ext } from '../extensionVariables';
import { SettingsService } from '../services/SettingsService';

export async function createActivityContextV2(withChildren?: boolean): Promise<ExecuteActivityContext> {
    return {
        registerActivity: async (activity) => ext.rgApiV2.activity.registerActivity(activity),
        suppressNotification: await SettingsService.getSetting('suppressActivityNotifications', 'azureResourceGroups'),
        activityChildren: withChildren ? [] : undefined,
    };
}
