/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import { API } from '../../AzureDBExperiences';
import { ext } from '../../extensionVariables';
import { type NewConnectionWizardContext } from './NewConnectionWizardContext';

export class PostgresExecuteStep extends AzureWizardExecuteStep<NewConnectionWizardContext> {
    public priority: number = 100;

    public async execute(context: NewConnectionWizardContext): Promise<void> {
        const api = context.experience?.api ?? API.Common;
        const connectionString = context.connectionString!;

        if (api === API.PostgresFlexible || api === API.PostgresSingle) {
            await ext.attachedAccountsNode.attachConnectionString(context, connectionString, api);
        }
    }

    public shouldExecute(context: NewConnectionWizardContext): boolean {
        return !!context.connectionString;
    }
}
