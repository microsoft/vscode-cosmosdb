/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import { ext } from '../../extensionVariables';
import { WorkspaceResourceType } from '../../tree/workspace/SharedWorkspaceResourceProvider';
import { SharedWorkspaceStorage, type SharedWorkspaceStorageItem } from '../../tree/workspace/SharedWorkspaceStorage';
import { type AttachEmulatorWizardContext } from './AttachEmulatorWizardContext';

export class ExecuteStep extends AzureWizardExecuteStep<AttachEmulatorWizardContext> {
    public priority: number = 100;

    public async execute(context: AttachEmulatorWizardContext): Promise<void> {
        const parentId = context.parentTreeElementId;
        const connectionString = context.connectionString;
        const port = context.port;
        const experience = context.experience;

        if (connectionString === undefined || port === undefined || experience === undefined) {
            throw new Error('Internal error: connectionString, port, and api must be defined.');
        }

        const label = `${experience.shortName} Emulator (${port})`;

        return ext.state.showCreatingChild(parentId, `Creating "${label}"...`, async () => {
            await new Promise((resolve) => setTimeout(resolve, 250));

            const storageItem: SharedWorkspaceStorageItem = {
                id: connectionString,
                name: label,
                properties: { isEmulator: true, api: experience.api },
                secrets: [connectionString],
            };

            await SharedWorkspaceStorage.push(WorkspaceResourceType.AttachedAccounts, storageItem, true);
        });
    }

    public shouldExecute(context: AttachEmulatorWizardContext): boolean {
        return !!context.connectionString;
    }
}
