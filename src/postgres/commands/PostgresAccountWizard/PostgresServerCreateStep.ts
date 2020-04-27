/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import PostgreSQLManagementClient from 'azure-arm-postgresql';
import { Progress } from 'vscode';
import { AzureWizardExecuteStep, callWithMaskHandling, createAzureClient } from 'vscode-azureextensionui';
import { ext } from '../../../extensionVariables';
import { localize } from '../../../utils/localize';
import { nonNullProp } from '../../../utils/nonNull';
import { IPostgresWizardContext } from './IPostgresWizardContext';

export class PostgresServerCreateStep extends AzureWizardExecuteStep<IPostgresWizardContext> {
    public priority: number = 150;

    public async execute(wizardContext: IPostgresWizardContext, progress: Progress<{ message?: string; increment?: number }>): Promise<void> {

        const locationName = nonNullProp(nonNullProp(wizardContext, 'location'), 'name');
        const rgName: string = nonNullProp(nonNullProp(wizardContext, 'resourceGroup'), 'name');
        const serverName = nonNullProp(wizardContext, 'newServerName');
        const user: string = nonNullProp(wizardContext, 'adminUser');
        const password: string = nonNullProp(wizardContext, 'adminPassword');

        return await callWithMaskHandling(
            async () => {
                const client: PostgreSQLManagementClient = createAzureClient(wizardContext, PostgreSQLManagementClient);
                const createMessage: string = localize('creatingPostgresServer', 'Creating PostgreSQL Server "{0}"... It should be ready in several minutes.', wizardContext.newServerName);
                ext.outputChannel.appendLog(createMessage);
                progress.report({ message: createMessage });
                const options = {
                    location: locationName,
                    properties: {
                        administratorLogin: user,
                        administratorLoginPassword: password,
                        sslEnforcement: "Enabled",
                        createMode: "Default"
                    },
                };

                wizardContext.server = await client.servers.create(rgName, serverName, options);
                ext.outputChannel.appendLog(localize('createdServerOutput', 'Successfully created PostgreSQL Server "{0}".', serverName));
            },
            password);
    }

    public shouldExecute(wizardContext: IPostgresWizardContext): boolean {
        return !wizardContext.server;
    }
}
