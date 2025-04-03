/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import ConnectionString from 'mongodb-connection-string-url';
import { API } from '../../AzureDBExperiences';
import { ext } from '../../extensionVariables';
import { type StorageItem, StorageService } from '../../services/storageService';
import { WorkspaceResourceType } from '../../tree/workspace-api/SharedWorkspaceResourceProvider';
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

            return ext.state.showCreatingChild(
                parentId,
                l10n.t('Creating "{nodeName}"…', { nodeName: label }),
                async () => {
                    await new Promise((resolve) => setTimeout(resolve, 250));

                    const storageItem: StorageItem = {
                        id: parsedCS.username + '@' + parsedCS.redact().toString(),
                        name: label,
                        properties: { isEmulator: false, api },
                        secrets: [connectionString],
                    };

                    await StorageService.get().push(WorkspaceResourceType.MongoClusters, storageItem, true);
                },
            );
        }
    }

    public shouldExecute(context: NewConnectionWizardContext): boolean {
        return !!context.connectionString;
    }
}
