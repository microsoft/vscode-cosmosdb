/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import { API } from '../../AzureDBExperiences';
import { ext } from '../../extensionVariables';
import { WorkspaceResourceType } from '../../tree/workspace/SharedWorkspaceResourceProvider';
import { SharedWorkspaceStorage, type SharedWorkspaceStorageItem } from '../../tree/workspace/SharedWorkspaceStorage';
import { AttachEmulatorMode, type AttachEmulatorWizardContext } from './AttachEmulatorWizardContext';

export class ExecuteStep extends AzureWizardExecuteStep<AttachEmulatorWizardContext> {
    public priority: number = 100;

    public async execute(context: AttachEmulatorWizardContext): Promise<void> {
        const parentId = context.parentTreeElementId;
        const connectionString = context.connectionString;
        const port = context.port;
        const experience = context.experience;

        switch (context.mode) {
            case AttachEmulatorMode.Preconfigured:
                if (connectionString === undefined || port === undefined || experience === undefined) {
                    throw new Error('Internal error: connectionString, port, and api must be defined.');
                }
                break;
            case AttachEmulatorMode.CustomConnectionString:
                if (connectionString === undefined || experience === undefined) {
                    throw new Error('Internal error: connectionString must be defined.');
                }
                break;
            default:
                throw new Error('Internal error: mode must be defined.');
        }

        let label = `${experience.shortName} Emulator (${port})`;

        if (experience.api === API.MongoDB || experience.api === API.MongoClusters) {
            label = `MongoDB Emulator (${port})`;
        }

        return ext.state.showCreatingChild(parentId, `Creating "${label}"...`, async () => {
            await new Promise((resolve) => setTimeout(resolve, 250));

            const storageItem: SharedWorkspaceStorageItem = {
                id: connectionString,
                name: label,
                properties: {
                    api: experience.api,
                    isEmulator: true,
                    // only adds 'disableEmulatorSecurity' when it's set (for Mongo)
                    ...(context.disableMongoEmulatorSecurity && { disableEmulatorSecurity: true }),
                },
                secrets: [connectionString],
            };

            if (experience.api === API.MongoDB) {
                await SharedWorkspaceStorage.push(WorkspaceResourceType.MongoClusters, storageItem, true);
            } else {
                await SharedWorkspaceStorage.push(WorkspaceResourceType.AttachedAccounts, storageItem, true);
            }
        });
    }

    public shouldExecute(context: AttachEmulatorWizardContext): boolean {
        return !!context.connectionString;
    }
}
