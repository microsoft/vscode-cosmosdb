/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { ext } from '../../extensionVariables';
import { type StorageItem, StorageNames, StorageService } from '../../services/StorageService';
import { WorkspaceResourceType } from '../../tree/workspace-api/SharedWorkspaceResourceProvider';
import { getEmulatorItemLabelForApi, getEmulatorItemUniqueId } from '../../utils/emulatorUtils';
import {
    NewEmulatorConnectionMode,
    type NewEmulatorConnectionWizardContext,
} from './NewEmulatorConnectionWizardContext';

export class ExecuteStep extends AzureWizardExecuteStep<NewEmulatorConnectionWizardContext> {
    public priority: number = 100;

    public async execute(context: NewEmulatorConnectionWizardContext): Promise<void> {
        const parentId = context.parentTreeElementId;
        const connectionString = context.connectionString;
        const port = context.port;
        const experience = context.experience;

        switch (context.mode) {
            case NewEmulatorConnectionMode.Preconfigured:
                if (connectionString === undefined || port === undefined || experience === undefined) {
                    throw new Error(l10n.t('Internal error: connectionString, port, and api must be defined.'));
                }
                break;
            case NewEmulatorConnectionMode.CustomConnectionString:
                if (connectionString === undefined || experience === undefined) {
                    throw new Error(l10n.t('Internal error: connectionString must be defined.'));
                }
                break;
            default:
                throw new Error(l10n.t('Internal error: mode must be defined.'));
        }

        const label = getEmulatorItemLabelForApi(experience.api, port);

        return ext.state.showCreatingChild(
            parentId,
            l10n.t('Creating "{nodeName}"…', { nodeName: label }),
            async () => {
                await new Promise((resolve) => setTimeout(resolve, 250));

                const storageItem: StorageItem = {
                    id: getEmulatorItemUniqueId(connectionString), // Use hash instead of raw connection string
                    name: label,
                    properties: {
                        api: experience.api,
                        isEmulator: true,
                    },
                    secrets: [connectionString], // Connection string still stored in secrets
                };

                await StorageService.get(StorageNames.Workspace).push(
                    WorkspaceResourceType.AttachedAccounts,
                    storageItem,
                    true,
                );
            },
        );
    }

    public shouldExecute(context: NewEmulatorConnectionWizardContext): boolean {
        return !!context.connectionString;
    }
}
