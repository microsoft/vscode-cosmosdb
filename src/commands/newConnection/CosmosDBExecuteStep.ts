/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { CoreExperience } from '../../AzureDBExperiences';
import { parseCosmosDBConnectionString } from '../../cosmosdb/cosmosDBConnectionStrings';
import { ext } from '../../extensionVariables';
import { type StorageItem, StorageNames, StorageService } from '../../services/StorageService';
import { WorkspaceResourceType } from '../../tree/workspace-api/SharedWorkspaceResourceProvider';
import { type NewConnectionWizardContext } from './NewConnectionWizardContext';

export class CosmosDBExecuteStep extends AzureWizardExecuteStep<NewConnectionWizardContext> {
    public priority: number = 100;

    public async execute(context: NewConnectionWizardContext): Promise<void> {
        const api = CoreExperience.api;
        const shortName = CoreExperience.shortName;
        const connectionString = context.connectionString!;
        const parentId = context.parentId;

        const parsedCS = parseCosmosDBConnectionString(connectionString);
        const label = `${parsedCS.accountId} (${shortName})`;

        return ext.state.showCreatingChild(
            parentId,
            l10n.t('Creating "{nodeName}"…', { nodeName: label }),
            async () => {
                await new Promise((resolve) => setTimeout(resolve, 250));

                const storageItem: StorageItem = {
                    id: parsedCS.accountId,
                    name: label,
                    properties: {
                        isEmulator: false,
                        api,
                        ...(parsedCS.tenantId && { tenantId: parsedCS.tenantId }),
                    },
                    secrets: [connectionString],
                };

                await StorageService.get(StorageNames.Workspace).push(
                    WorkspaceResourceType.AttachedAccounts,
                    storageItem,
                    true,
                );
            },
        );
    }

    public shouldExecute(context: NewConnectionWizardContext): boolean {
        return !!context.connectionString;
    }
}
