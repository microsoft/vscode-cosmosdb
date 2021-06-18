/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { Progress } from 'vscode';
import { AzureWizardExecuteStep, callWithMaskHandling, createAzureClient, LocationListStep } from 'vscode-azureextensionui';
import { ext } from '../../../../extensionVariables';
import { localize } from '../../../../utils/localize';
import { nonNullProp } from '../../../../utils/nonNull';
import { AbstractPostgresClient } from '../../../abstract/AbstractPostgresClient';
import { IAbstractPostgresClient } from '../../../abstract/IAbstractPostgresClient';
import { AbstractServerCreate } from '../../../abstract/models';
import { IPostgresServerWizardContext } from '../IPostgresServerWizardContext';

export class PostgresServerCreateStep extends AzureWizardExecuteStep<IPostgresServerWizardContext> {
    public priority: number = 150;
    public defaultVersion: string = "11";

    public async execute(wizardContext: IPostgresServerWizardContext, progress: Progress<{ message?: string; increment?: number }>): Promise<void> {

        const locationName: string = (await LocationListStep.getLocation(wizardContext)).name;
        const rgName: string = nonNullProp(nonNullProp(wizardContext, 'resourceGroup'), 'name');
        const storageMB: string = nonNullProp(nonNullProp(wizardContext, 'sku'), 'size');
        const newServerName = nonNullProp(wizardContext, 'newServerName');
        const password: string = nonNullProp(wizardContext, 'adminPassword');

        return await callWithMaskHandling(
            async () => {
                const serverType = nonNullProp(wizardContext, 'serverType');
                const client: IAbstractPostgresClient = createAzureClient(wizardContext, AbstractPostgresClient);
                const createMessage: string = localize('creatingPostgresServer', 'Creating PostgreSQL Server "{0}"... It should be ready in several minutes.', wizardContext.newServerName);
                ext.outputChannel.appendLog(createMessage);
                progress.report({ message: createMessage });
                const options: AbstractServerCreate = {
                    location: locationName,
                    sku: nonNullProp(wizardContext, 'sku'),
                    administratorLogin: nonNullProp(wizardContext, 'shortUserName'),
                    administratorLoginPassword: password,
                    sslEnforcement: "Enabled",
                    version: this.defaultVersion,
                    storageMB: parseInt(storageMB)
                };

                wizardContext.server = await client.createServer(serverType, rgName, newServerName, options) ;
            },
            password);
    }

    public shouldExecute(wizardContext: IPostgresServerWizardContext): boolean {
        return !wizardContext.server;
    }
}
