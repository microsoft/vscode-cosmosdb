/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type TriggerDefinition } from '@azure/cosmos';
import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { getControlPlane } from '../../cosmosdb/controlPlane';
import { ext } from '../../extensionVariables';
import { type CreateTriggerWizardContext } from './CreateTriggerWizardContext';

export class CosmosDBExecuteStep extends AzureWizardExecuteStep<CreateTriggerWizardContext> {
    public priority: number = 100;

    public async execute(context: CreateTriggerWizardContext): Promise<void> {
        const { containerId, databaseId, triggerBody, triggerName, triggerOperation, triggerType, nodeId } = context;

        return ext.state.showCreatingChild(
            nodeId,
            l10n.t('Creating "{nodeName}"…', { nodeName: triggerName! }),
            async () => {
                await new Promise((resolve) => setTimeout(resolve, 250));

                const body: TriggerDefinition = {
                    id: triggerName,
                    body: triggerBody!,
                    triggerType: triggerType!,
                    triggerOperation: triggerOperation!,
                };

                const controlPlane = getControlPlane(context.accountInfo);
                context.response = await controlPlane.createTrigger(databaseId, containerId, body);
            },
        );
    }

    public shouldExecute(context: CreateTriggerWizardContext): boolean {
        return !!context.triggerName && !!context.triggerType && !!context.triggerOperation && !!context.triggerBody;
    }
}
