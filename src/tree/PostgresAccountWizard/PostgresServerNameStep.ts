/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import PostgreSQLManagementClient from 'azure-arm-postgresql';
import { NameAvailability, NameAvailabilityRequest } from 'azure-arm-postgresql/lib/models';
import { AzureNameStep, createAzureClient, ResourceGroupListStep, resourceGroupNamingRules } from 'vscode-azureextensionui';
import { ext } from '../../extensionVariables';
import { IPostgresWizardContext } from './IPostgresWizardContext';

export class PostgresServerNameStep extends AzureNameStep<IPostgresWizardContext> {

    public async prompt(wizardContext: IPostgresWizardContext): Promise<void> {
        const client: PostgreSQLManagementClient = createAzureClient(wizardContext, PostgreSQLManagementClient);
        wizardContext.serverName = (await ext.ui.showInputBox({
            placeHolder: "Server name",
            prompt: "Provide a name for the Postgres Server.",
            validateInput: (name: string) => validatePostgresAccountName(name, client)
        })).trim();

        wizardContext.relatedNameTask = this.generateRelatedName(wizardContext, wizardContext.serverName, resourceGroupNamingRules);
    }

    public shouldPrompt(wizardContext: IPostgresWizardContext): boolean {
        return !wizardContext.serverName;
    }

    protected async isRelatedNameAvailable(wizardContext: IPostgresWizardContext, name: string): Promise<boolean> {
        return await ResourceGroupListStep.isNameAvailable(wizardContext, name);
    }
}

async function validatePostgresAccountName(name: string, client: PostgreSQLManagementClient): Promise<string | undefined> {
    name = name ? name.trim() : '';

    const min = 3;
    const max = 63;

    const availabilityRequest: NameAvailabilityRequest = { name: name, type: "Microsoft.DBforPostgreSQL" };
    const availability: NameAvailability = (await client.checkNameAvailability.execute(availabilityRequest));

    if (name.length < min || name.length > max) {
        return `The name must be between ${min} and ${max} characters.`;
    } else if (!availability.nameAvailable) {
        return availability.message;
    } else {
        return undefined;
    }

}
