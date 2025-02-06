/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import ConnectionString from 'mongodb-connection-string-url';
import { API } from '../../AzureDBExperiences';
import { ext } from '../../extensionVariables';
import { WorkspaceResourceType } from '../../tree/workspace/SharedWorkspaceResourceProvider';
import { SharedWorkspaceStorage, type SharedWorkspaceStorageItem } from '../../tree/workspace/SharedWorkspaceStorage';
import { type AttachAccountWizardContext } from './AttachAccountWizardContext';

export class MongoExecuteStep extends AzureWizardExecuteStep<AttachAccountWizardContext> {
    public priority: number = 100;

    public async execute(context: AttachAccountWizardContext): Promise<void> {
        const api = context.experience?.api ?? API.Common;
        const connectionString = context.connectionString!;
        const parentId = context.parentId;

        if (api === API.MongoDB || api === API.MongoClusters) {
            const parsedCS = new ConnectionString(connectionString);

            let label = parsedCS.username + '@' + parsedCS.hosts.join(',');
            if (context.mongodbapiIsEmulator) {
                label = `Emulator (${parsedCS.hosts.join(',')})`;
            }

            return ext.state.showCreatingChild(parentId, `Creating "${label}"...`, async () => {
                await new Promise((resolve) => setTimeout(resolve, 250));

                const storageItem: SharedWorkspaceStorageItem = {
                    id: parsedCS.username + '@' + parsedCS.redact().toString(),
                    name: label,
                    properties: { isEmulator: context.mongodbapiIsEmulator ?? false, api },
                    secrets: [connectionString],
                };

                await SharedWorkspaceStorage.push(WorkspaceResourceType.MongoClusters, storageItem, true);
            });
        }
    }

    public shouldExecute(context: AttachAccountWizardContext): boolean {
        return !!context.connectionString;
    }
}
