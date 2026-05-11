/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type StoredProcedureDefinition } from '@azure/cosmos';
import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { withClaimsChallengeHandling } from '../../cosmosdb/withClaimsChallengeHandling';
import { ext } from '../../extensionVariables';
import { nonNullProp } from '../../utils/nonNull';
import { type CreateStoredProcedureWizardContext } from './CreateStoredProcedureWizardContext';

export class CosmosDBExecuteStep extends AzureWizardExecuteStep<CreateStoredProcedureWizardContext> {
    public priority: number = 100;

    public async execute(context: CreateStoredProcedureWizardContext): Promise<void> {
        const { containerId, databaseId, storedProcedureBody, storedProcedureName, nodeId } = context;

        return ext.state.showCreatingChild(
            nodeId,
            l10n.t('Creating "{nodeName}"…', { nodeName: storedProcedureName! }),
            async () => {
                await new Promise((resolve) => setTimeout(resolve, 250));

                const body: StoredProcedureDefinition = {
                    id: storedProcedureName,
                    body: storedProcedureBody!,
                };

                context.response = await withClaimsChallengeHandling(context.accountInfo, async (client) => {
                    const response = await client
                        .database(databaseId)
                        .container(containerId)
                        .scripts.storedProcedures.create(body);
                    return nonNullProp(response, 'resource');
                });
            },
        );
    }

    public shouldExecute(context: CreateStoredProcedureWizardContext): boolean {
        return !!context.storedProcedureName && !!context.storedProcedureBody;
    }
}
