/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { PostgreSQLManagementClient, PostgreSQLManagementModels as SingleModels } from "@azure/arm-postgresql";
import { PostgreSQLManagementClient as PostgreSQLFlexibleManagementClient, PostgreSQLManagementModels as FlexibleModels } from "@azure/arm-postgresql-flexible";
import { Progress } from 'vscode';
import { AzureWizardExecuteStep, callWithMaskHandling, createAzureClient, LocationListStep } from 'vscode-azureextensionui';
import { ext } from '../../../../extensionVariables';
import { localize } from '../../../../utils/localize';
import { nonNullProp } from '../../../../utils/nonNull';
import { AbstractServerCreate, PostgresServerType } from '../../../abstract/models';
import { IPostgresServerWizardContext } from '../IPostgresServerWizardContext';

export class PostgresServerCreateStep extends AzureWizardExecuteStep<IPostgresServerWizardContext> {
    public priority: number = 150;
    public defaultVersion: string = "11";

    public async execute(context: IPostgresServerWizardContext, progress: Progress<{ message?: string; increment?: number }>): Promise<void> {

        const locationName: string = (await LocationListStep.getLocation(context)).name;
        const rgName: string = nonNullProp(nonNullProp(context, 'resourceGroup'), 'name');
        const storageMB: string = nonNullProp(nonNullProp(context, 'sku'), 'size');
        const newServerName = nonNullProp(context, 'newServerName');
        const password: string = nonNullProp(context, 'adminPassword');

        return await callWithMaskHandling(
            async () => {
                const serverType = nonNullProp(wizardContext, 'serverType');
                const createMessage: string = localize('creatingPostgresServer', 'Creating PostgreSQL Server "{0}"... It should be ready in several minutes.', context.newServerName);

                ext.outputChannel.appendLog(createMessage);
                progress.report({ message: createMessage });
                const options: AbstractServerCreate = {
                    location: locationName,
                    sku: nonNullProp(context, 'sku'),
                    administratorLogin: nonNullProp(context, 'shortUserName'),
                    administratorLoginPassword: password,
                    version: this.defaultVersion,
                    storageMB: parseInt(storageMB)
                };

                switch (serverType){
                    case PostgresServerType.Single:
                        const singleClient = createAzureClient(context, PostgreSQLManagementClient);
                        context.server = await singleClient.servers.create(rgName, newServerName, this.asSingleParameters(options));
                        break;
                    case PostgresServerType.Flexible:
                        const flexiClient = createAzureClient(context, PostgreSQLFlexibleManagementClient);
                        context.server = await flexiClient.servers.create(rgName, newServerName, this.asFlexibleParameters(options));
                        break;
                }
                context.server.serverType = serverType;
            },
            password);
    }

    public shouldExecute(context: IPostgresServerWizardContext): boolean {
        return !context.server;
    }


    private asFlexibleParameters(parameters: AbstractServerCreate) : FlexibleModels.Server {
        return {
            location: parameters.location,
            version: parameters.version as FlexibleModels.ServerVersion,
            administratorLogin: parameters.administratorLogin,
            administratorLoginPassword: parameters.administratorLoginPassword,
            storageProfile: {
                storageMB: parameters.storageMB
            },
            sku: {
                name: parameters.sku.name,
                tier: parameters.sku.tier as FlexibleModels.SkuTier
            },
        }
    }

    private asSingleParameters(parameters: AbstractServerCreate) : SingleModels.ServerForCreate {
        return {
            location: parameters.location,
            sku: {
                name: parameters.sku.name,
                capacity: parameters.sku.capacity,
                size: parameters.sku.size,
                family: parameters.sku.family,
                tier: parameters.sku.tier as SingleModels.SkuTier
            },
            properties: {
                administratorLogin: parameters.administratorLogin,
                administratorLoginPassword: parameters.administratorLoginPassword,
                sslEnforcement: "Enabled",
                createMode: "Default",
                version: parameters.version as SingleModels.ServerVersion,
                storageProfile: {
                    storageMB: parameters.storageMB
                }
            }
        }
    }

}
