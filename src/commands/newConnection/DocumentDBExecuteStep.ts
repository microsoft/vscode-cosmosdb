/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { API, getExperienceFromApi } from '../../AzureDBExperiences';
import { parseDocDBConnectionString } from '../../docdb/docDBConnectionStrings';
import { ext } from '../../extensionVariables';
import { WorkspaceResourceType } from '../../tree/workspace-api/SharedWorkspaceResourceProvider';
import {
    SharedWorkspaceStorage,
    type SharedWorkspaceStorageItem,
} from '../../tree/workspace-api/SharedWorkspaceStorage';
import { type NewConnectionWizardContext } from './NewConnectionWizardContext';

export class DocumentDBExecuteStep extends AzureWizardExecuteStep<NewConnectionWizardContext> {
    public priority: number = 100;

    public async execute(context: NewConnectionWizardContext): Promise<void> {
        const api = context.experience?.api ?? API.Common;
        const connectionString = context.connectionString!;
        const parentId = context.parentId;

        if (api === API.Core || api === API.Table || api === API.Graph || api === API.Cassandra) {
            const parsedCS = parseDocDBConnectionString(connectionString);
            const label = `${parsedCS.accountId} (${getExperienceFromApi(api).shortName})`;

            return ext.state.showCreatingChild(
                parentId,
                l10n.t('Creating "{nodeName}"…', { nodeName: label }),
                async () => {
                    await new Promise((resolve) => setTimeout(resolve, 250));

                    const storageItem: SharedWorkspaceStorageItem = {
                        id: parsedCS.accountId,
                        name: label,
                        properties: { isEmulator: false, api },
                        secrets: [connectionString],
                    };

                    await SharedWorkspaceStorage.push(WorkspaceResourceType.AttachedAccounts, storageItem, true);
                },
            );
        }
    }

    public shouldExecute(context: NewConnectionWizardContext): boolean {
        return !!context.connectionString;
    }
}
