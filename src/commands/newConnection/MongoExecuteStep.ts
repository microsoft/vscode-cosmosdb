/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import ConnectionString from 'mongodb-connection-string-url';
import * as vscode from 'vscode';
import { API } from '../../AzureDBExperiences';
import { ext } from '../../extensionVariables';
import { WorkspaceResourceType } from '../../tree/workspace-api/SharedWorkspaceResourceProvider';
import {
    SharedWorkspaceStorage,
    type SharedWorkspaceStorageItem,
} from '../../tree/workspace-api/SharedWorkspaceStorage';
import { type NewConnectionWizardContext } from './NewConnectionWizardContext';

export class MongoExecuteStep extends AzureWizardExecuteStep<NewConnectionWizardContext> {
    public priority: number = 100;

    public async execute(context: NewConnectionWizardContext): Promise<void> {
        const api = context.experience?.api ?? API.Common;
        const connectionString = context.connectionString!;
        const parentId = context.parentId;

        if (api === API.MongoDB || api === API.MongoClusters) {
            const parsedCS = new ConnectionString(connectionString);

            const label = parsedCS.username + '@' + parsedCS.hosts.join(',');

            return ext.state.showCreatingChild(parentId, vscode.l10n.t(`Creating "{0}"...`, label), async () => {
                await new Promise((resolve) => setTimeout(resolve, 250));

                const storageItem: SharedWorkspaceStorageItem = {
                    id: parsedCS.username + '@' + parsedCS.redact().toString(),
                    name: label,
                    properties: { isEmulator: false, api },
                    secrets: [connectionString],
                };

                await SharedWorkspaceStorage.push(WorkspaceResourceType.MongoClusters, storageItem, true);
            });
        }
    }

    public shouldExecute(context: NewConnectionWizardContext): boolean {
        return !!context.connectionString;
    }
}
