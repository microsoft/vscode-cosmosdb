/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Server } from 'azure-arm-postgresql/lib/models';
import { Progress } from 'vscode';
import { AzureWizardExecuteStep } from 'vscode-azureextensionui';
import { localize } from '../../../utils/localize';
import { nonNullProp } from '../../../utils/nonNull';
import { setPostgresCredentials } from '../setPostgresCredentials';
import { IPostgresWizardContext } from './IPostgresWizardContext';

export class PostgresServerSetCredentialsStep extends AzureWizardExecuteStep<IPostgresWizardContext> {
    public priority: number = 200;

    public async execute(wizardContext: IPostgresWizardContext, progress: Progress<{ message?: string; increment?: number }>): Promise<void> {

        let user: string = nonNullProp(wizardContext, 'adminUser');
        const serverName: string = nonNullProp(wizardContext, 'accountName');
        const usernameSuffix: string = `@${serverName}`;
        if (!user.includes(usernameSuffix)) {
            user += usernameSuffix;
        }
        const setupMessage: string = localize('setupCredentialsMessage', 'Setting up Credentials for server "{0}"...', serverName);
        progress.report({ message: setupMessage });

        const password: string = nonNullProp(wizardContext, 'adminPassword');
        const server: Server = nonNullProp(wizardContext, 'server');

        await setPostgresCredentials(user, password, nonNullProp(server, 'id'));
    }

    public shouldExecute(): boolean {
        return true;
    }
}
