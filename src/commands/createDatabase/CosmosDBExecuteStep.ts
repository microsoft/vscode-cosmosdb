/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { getControlPlane } from '../../cosmosdb/controlPlane';
import { ext } from '../../extensionVariables';
import { type CreateDatabaseWizardContext } from './CreateDatabaseWizardContext';

export class CosmosDBExecuteStep extends AzureWizardExecuteStep<CreateDatabaseWizardContext> {
    public priority: number = 100;

    public async execute(context: CreateDatabaseWizardContext): Promise<void> {
        const { databaseName, nodeId } = context;

        return ext.state.showCreatingChild(
            nodeId,
            l10n.t('Creating "{nodeName}"…', { nodeName: databaseName! }),
            async () => {
                await new Promise((resolve) => setTimeout(resolve, 250));
                const controlPlane = getControlPlane(context.accountInfo);
                await controlPlane.createDatabase(databaseName!);
            },
        );
    }

    public shouldExecute(context: CreateDatabaseWizardContext): boolean {
        return !!context.databaseName;
    }
}
