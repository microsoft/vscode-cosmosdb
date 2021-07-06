/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PostgreSQLManagementClient } from '@azure/arm-postgresql';
import { NameAvailability, NameAvailabilityRequest } from '@azure/arm-postgresql/src/models';
import { AzureNameStep, createAzureClient, ResourceGroupListStep, resourceGroupNamingRules } from 'vscode-azureextensionui';
import { localize } from '../../../../utils/localize';
import { IPostgresServerWizardContext } from '../IPostgresServerWizardContext';

export class PostgresServerNameStep extends AzureNameStep<IPostgresServerWizardContext> {

    public async prompt(context: IPostgresServerWizardContext): Promise<void> {
        const client: PostgreSQLManagementClient = createAzureClient(context, PostgreSQLManagementClient);
        context.newServerName = (await context.ui.showInputBox({
            placeHolder: localize('serverNamePlaceholder', 'Server name'),
            prompt: localize('enterServerNamePrompt', 'Provide a name for the PostgreSQL Server.'),
            validateInput: (name: string) => validatePostgresServerName(name, client)
        })).trim();
        context.valuesToMask.push(context.newServerName);
        context.relatedNameTask = this.generateRelatedName(context, context.newServerName, resourceGroupNamingRules);
    }

    public shouldPrompt(context: IPostgresServerWizardContext): boolean {
        return !context.newServerName;
    }

    protected async isRelatedNameAvailable(context: IPostgresServerWizardContext, name: string): Promise<boolean> {
        return await ResourceGroupListStep.isNameAvailable(context, name);
    }
}

async function validatePostgresServerName(name: string, client: PostgreSQLManagementClient): Promise<string | undefined> {
    name = name ? name.trim() : '';

    const min = 3;
    const max = 63;

    if (name.length < min || name.length > max) {
        return localize('serverNameLengthCheck', 'The name must be between {0} and {1} characters.', min, max);
    } else if (!(/^[a-z0-9-]+$/).test(name)) {
        return localize('serverNameCharacterCheck', 'Server name must only contain lowercase letters, numbers, and hyphens.');
    } else if (name.startsWith('-') || name.endsWith('-')) {
        return localize('serverNamePrefixSuffixCheck', 'Server name must not start or end in a hyphen.');
    }

    const availabilityRequest: NameAvailabilityRequest = { name: name, type: "Microsoft.DBforPostgreSQL" };
    const availability: NameAvailability = (await client.checkNameAvailability.execute(availabilityRequest));

    if (!availability.nameAvailable) {
        if (availability.reason === 'AlreadyExists') {
            return localize('serverNameAvailabilityCheck', 'A server named "{0}" already exists.', name);
        }
    }

    return undefined;

}
