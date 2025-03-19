/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type StoredProcedureDefinition } from '@azure/cosmos';
import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { getCosmosClient } from '../../docdb/getCosmosClient';
import { ext } from '../../extensionVariables';
import { type CreateStoredProcedureWizardContext } from './CreateStoredProcedureWizardContext';

export class DocumentDBExecuteStep extends AzureWizardExecuteStep<CreateStoredProcedureWizardContext> {
    public priority: number = 100;

    public async execute(context: CreateStoredProcedureWizardContext): Promise<void> {
        const { endpoint, credentials, isEmulator } = context.accountInfo;
        const { containerId, databaseId, storedProcedureBody, storedProcedureName, nodeId } = context;
        const cosmosClient = getCosmosClient(endpoint, credentials, isEmulator);

        return ext.state.showCreatingChild(
            nodeId,
            l10n.t('Creating "{nodeName}"…', { nodeName: storedProcedureName! }),
            async () => {
                await new Promise((resolve) => setTimeout(resolve, 250));

                const body: StoredProcedureDefinition = {
                    id: storedProcedureName,
                    body: storedProcedureBody!,
                };

                const response = await cosmosClient
                    .database(databaseId)
                    .container(containerId)
                    .scripts.storedProcedures.create(body);

                context.response = response.resource;
            },
        );
    }

    public shouldExecute(context: CreateStoredProcedureWizardContext): boolean {
        return !!context.storedProcedureName && !!context.storedProcedureBody;
    }
}
