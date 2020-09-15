/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import PostgreSQLManagementClient from 'azure-arm-postgresql';
import { Progress } from 'vscode';
import { AzureWizardExecuteStep, callWithMaskHandling, createAzureClient } from 'vscode-azureextensionui';
import { ext } from '../../../../extensionVariables';
import { localize } from '../../../../utils/localize';
import { nonNullProp } from '../../../../utils/nonNull';
import { IPostgresServerWizardContext } from '../IPostgresServerWizardContext';

export class PostgresServerCreateStep extends AzureWizardExecuteStep<IPostgresServerWizardContext> {
    public priority: number = 150;

    public async execute(wizardContext: IPostgresServerWizardContext, progress: Progress<{ message?: string; increment?: number }>): Promise<void> {

        const locationName = nonNullProp(nonNullProp(wizardContext, 'location'), 'name');
        const rgName: string = nonNullProp(nonNullProp(wizardContext, 'resourceGroup'), 'name');
        const newServerName = nonNullProp(wizardContext, 'newServerName');
        const password: string = nonNullProp(wizardContext, 'adminPassword');

        return await callWithMaskHandling(
            async () => {
                const client: PostgreSQLManagementClient = createAzureClient(wizardContext, PostgreSQLManagementClient);
                const createMessage: string = localize('creatingPostgresServer', 'Creating PostgreSQL Server "{0}"... It should be ready in several minutes.', wizardContext.newServerName);
                ext.outputChannel.appendLog(createMessage);
                progress.report({ message: createMessage });
                const options = {
                    location: locationName,
                    sku: {
                        name: "GP_Gen5_4",
                        tier: "GeneralPurpose",
                        capacity: 4,
                        family: "Gen5",
                        size: "102400"
                    },
                    properties: {
                        administratorLogin: nonNullProp(wizardContext, 'shortUserName'),
                        administratorLoginPassword: password,
                        sslEnforcement: "Enabled",
                        createMode: "Default",
                        version: "10",
                        storageProfile: {
                            storageMB: 102400
                        }
                    },
                };

                wizardContext.server = await client.servers.create(rgName, newServerName, options);
            },
            password);
    }

    public shouldExecute(wizardContext: IPostgresServerWizardContext): boolean {
        return !wizardContext.server;
    }
}
