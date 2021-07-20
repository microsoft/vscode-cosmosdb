/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Progress } from 'vscode';
import { AzureWizardExecuteStep } from 'vscode-azureextensionui';
import { IPersistedServer } from '../../../../constants';
import { ext } from '../../../../extensionVariables';
import { localize } from '../../../../utils/localize';
import { nonNullProp } from '../../../../utils/nonNull';
import { PostgresAbstractServer } from '../../../abstract/models';
import { createOrUpdateGlobalPersistedServer } from '../../createOrUpdateGlobalPersistedServer';
import { IPostgresServerWizardContext } from '../IPostgresServerWizardContext';

export class PostgresServerSetCredentialsStep extends AzureWizardExecuteStep<IPostgresServerWizardContext> {
    public priority: number = 200;

    public async execute(context: IPostgresServerWizardContext, progress: Progress<{ message?: string; increment?: number }>): Promise<void> {

        const user: string = nonNullProp(context, 'longUserName');
        const newServerName: string = nonNullProp(context, 'newServerName');

        const setupMessage: string = localize('setupCredentialsMessage', 'Setting up Credentials for server "{0}"...', newServerName);
        progress.report({ message: setupMessage });
        ext.outputChannel.appendLog(setupMessage);
        const password: string = nonNullProp(context, 'adminPassword');
        const server: PostgresAbstractServer = nonNullProp(context, 'server');

        const persistedServer: IPersistedServer = { id: nonNullProp(server, 'id'), username: user, isFirewallRuleSet: false };
        await createOrUpdateGlobalPersistedServer(persistedServer, password);
        const completedMessage: string = localize('addedCredentialsMessage', 'Successfully setup credentials for server "{0}".', newServerName);
        void vscode.window.showInformationMessage(completedMessage);
        ext.outputChannel.appendLog(completedMessage);
    }

    public shouldExecute(): boolean {
        return true;
    }
}
