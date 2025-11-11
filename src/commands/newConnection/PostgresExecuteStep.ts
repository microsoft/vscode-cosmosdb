/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import { openPostgresExtension } from '../../postgres/deprecation';
import { type NewConnectionWizardContext } from './NewConnectionWizardContext';

export class PostgresExecuteStep extends AzureWizardExecuteStep<NewConnectionWizardContext> {
    public priority: number = 100;

    public async execute(_context: NewConnectionWizardContext): Promise<void> {
        /* Postgres connections are now deprecated, we open the official PG extension instead
        const api = context.experience?.api ?? API.Common;
        const connectionString = context.connectionString!;

        if (api === API.PostgresFlexible || api === API.PostgresSingle) {
            await ext.attachedAccountsNode.attachConnectionString(context, connectionString, api);
        }
        */
        await openPostgresExtension();
    }

    public shouldExecute(_context: NewConnectionWizardContext): boolean {
        return true; //!!context.connectionString;
    }
}
