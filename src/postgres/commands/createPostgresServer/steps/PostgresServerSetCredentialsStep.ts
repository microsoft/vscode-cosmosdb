/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { Progress } from 'vscode';
import { ext } from '../../../../extensionVariables';
import { localize } from '../../../../utils/localize';
import { nonNullProp } from '../../../../utils/nonNull';
import { PostgresAbstractServer, PostgresServerType } from '../../../abstract/models';
import { setPostgresCredentials } from '../../setPostgresCredentials';
import { IPostgresServerWizardContext } from '../IPostgresServerWizardContext';

export class PostgresServerSetCredentialsStep extends AzureWizardExecuteStep<IPostgresServerWizardContext> {
    public priority: number = 200;

    public async execute(
        context: IPostgresServerWizardContext,
        progress: Progress<{ message?: string; increment?: number }>,
    ): Promise<void> {
        let user: string;
        // Username doesn't contain servername prefix for Postgres Flexible Servers only
        // As present on the portal for any Flexbile Server instance
        if (context.serverType && context.serverType === PostgresServerType.Single) {
            user = nonNullProp(context, 'longUserName');
        } else {
            user = nonNullProp(context, 'shortUserName');
        }
        const newServerName: string = nonNullProp(context, 'newServerName');

        const setupMessage: string = localize(
            'setupCredentialsMessage',
            'Setting up Credentials for server "{0}"...',
            newServerName,
        );
        progress.report({ message: setupMessage });
        ext.outputChannel.appendLog(setupMessage);
        const password: string = nonNullProp(context, 'adminPassword');
        const server: PostgresAbstractServer = nonNullProp(context, 'server');

        await setPostgresCredentials(user, password, nonNullProp(server, 'id'));
        const completedMessage: string = localize(
            'addedCredentialsMessage',
            'Successfully setup credentials for server "{0}".',
            newServerName,
        );
        void vscode.window.showInformationMessage(completedMessage);
        ext.outputChannel.appendLog(completedMessage);
    }

    public shouldExecute(): boolean {
        return true;
    }
}
