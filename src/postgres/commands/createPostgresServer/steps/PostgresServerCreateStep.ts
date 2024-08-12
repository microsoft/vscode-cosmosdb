/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as SingleModels from '@azure/arm-postgresql';
import * as FlexibleModels from '@azure/arm-postgresql-flexible';
import { LocationListStep } from '@microsoft/vscode-azext-azureutils';
import { AzureWizardExecuteStep, callWithMaskHandling } from '@microsoft/vscode-azext-utils';
import { AppResource } from '@microsoft/vscode-azext-utils/hostapi';
import { Progress } from 'vscode';
import { ext } from '../../../../extensionVariables';
import { createPostgreSQLClient, createPostgreSQLFlexibleClient } from '../../../../utils/azureClients';
import { localize } from '../../../../utils/localize';
import { nonNullProp } from '../../../../utils/nonNull';
import { AbstractServerCreate, PostgresServerType } from '../../../abstract/models';
import { IPostgresServerWizardContext } from '../IPostgresServerWizardContext';

export class PostgresServerCreateStep extends AzureWizardExecuteStep<IPostgresServerWizardContext> {
    public priority: number = 150;

    public async execute(
        context: IPostgresServerWizardContext,
        progress: Progress<{ message?: string; increment?: number }>,
    ): Promise<void> {
        const locationName: string = (await LocationListStep.getLocation(context)).name;
        const rgName: string = nonNullProp(nonNullProp(context, 'resourceGroup'), 'name');
        const size: string = nonNullProp(nonNullProp(context, 'sku'), 'size');
        const newServerName = nonNullProp(context, 'newServerName');
        const password: string = nonNullProp(context, 'adminPassword');

        return await callWithMaskHandling(async () => {
            const serverType = nonNullProp(context, 'serverType');
            const createMessage: string = localize(
                'creatingPostgresServer',
                'Creating PostgreSQL Server "{0}"... It should be ready in several minutes.',
                context.newServerName,
            );

            ext.outputChannel.appendLog(createMessage);
            progress.report({ message: createMessage });
            const options: AbstractServerCreate = {
                location: locationName,
                sku: nonNullProp(context, 'sku'),
                administratorLogin: nonNullProp(context, 'shortUserName'),
                administratorLoginPassword: password,
                size: parseInt(size),
            };

            switch (serverType) {
                case PostgresServerType.Single:
                    const singleClient: SingleModels.PostgreSQLManagementClient = await createPostgreSQLClient(context);
                    context.server = await singleClient.servers.beginCreateAndWait(
                        rgName,
                        newServerName,
                        this.asSingleParameters(options),
                    );
                    break;
                case PostgresServerType.Flexible:
                    const flexiClient: FlexibleModels.PostgreSQLManagementFlexibleServerClient =
                        await createPostgreSQLFlexibleClient(context);
                    context.server = await flexiClient.servers.beginCreateAndWait(
                        rgName,
                        newServerName,
                        this.asFlexibleParameters(options),
                    );
                    break;
            }
            context.server.serverType = serverType;
            context.activityResult = context.server as AppResource;
        }, password);
    }

    public shouldExecute(context: IPostgresServerWizardContext): boolean {
        return !context.server;
    }

    private asFlexibleParameters(parameters: AbstractServerCreate): FlexibleModels.Server {
        return {
            location: parameters.location,
            version: FlexibleModels.KnownServerVersion.Fourteen,
            administratorLogin: parameters.administratorLogin,
            administratorLoginPassword: parameters.administratorLoginPassword,
            storage: {
                storageSizeGB: parameters.size,
            },
            sku: {
                name: parameters.sku.name,
                tier: parameters.sku.tier,
            },
        };
    }

    private asSingleParameters(parameters: AbstractServerCreate): SingleModels.ServerForCreate {
        return {
            location: parameters.location,
            sku: {
                name: parameters.sku.name,
                capacity: parameters.sku.capacity,
                size: parameters.sku.size,
                family: parameters.sku.family,
                tier: parameters.sku.tier as SingleModels.SkuTier,
            },
            properties: {
                administratorLogin: parameters.administratorLogin,
                administratorLoginPassword: parameters.administratorLoginPassword,
                sslEnforcement: 'Enabled',
                createMode: 'Default',
                version: SingleModels.KnownServerVersion.Eleven,
                storageProfile: {
                    storageMB: parameters.size,
                },
            },
        };
    }
}
