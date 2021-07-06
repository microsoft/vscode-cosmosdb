/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { PostgreSQLManagementClient } from '@azure/arm-postgresql';
import { ServerForCreate } from '@azure/arm-postgresql/src/models';
import { Progress } from 'vscode';
import { AzureWizardExecuteStep, callWithMaskHandling, createAzureClient, LocationListStep } from 'vscode-azureextensionui';
import { ext } from '../../../../extensionVariables';
import { localize } from '../../../../utils/localize';
import { nonNullProp } from '../../../../utils/nonNull';
import { IPostgresServerWizardContext } from '../IPostgresServerWizardContext';

export class PostgresServerCreateStep extends AzureWizardExecuteStep<IPostgresServerWizardContext> {
    public priority: number = 150;

    public async execute(context: IPostgresServerWizardContext, progress: Progress<{ message?: string; increment?: number }>): Promise<void> {

        const locationName: string = (await LocationListStep.getLocation(context)).name;
        const rgName: string = nonNullProp(nonNullProp(context, 'resourceGroup'), 'name');
        const storageMB: string = nonNullProp(nonNullProp(context, 'sku'), 'size');
        const newServerName = nonNullProp(context, 'newServerName');
        const password: string = nonNullProp(context, 'adminPassword');

        return await callWithMaskHandling(
            async () => {
                const client: PostgreSQLManagementClient = createAzureClient(context, PostgreSQLManagementClient);
                const createMessage: string = localize('creatingPostgresServer', 'Creating PostgreSQL Server "{0}"... It should be ready in several minutes.', context.newServerName);
                ext.outputChannel.appendLog(createMessage);
                progress.report({ message: createMessage });
                const options: ServerForCreate = {
                    location: locationName,
                    sku: nonNullProp(context, 'sku'),
                    properties: {
                        administratorLogin: nonNullProp(context, 'shortUserName'),
                        administratorLoginPassword: password,
                        sslEnforcement: "Enabled",
                        createMode: "Default",
                        version: "10",
                        storageProfile: {
                            storageMB: parseInt(storageMB)
                        }
                    },
                };

                context.server = await client.servers.create(rgName, newServerName, options);
            },
            password);
    }

    public shouldExecute(context: IPostgresServerWizardContext): boolean {
        return !context.server;
    }
}
