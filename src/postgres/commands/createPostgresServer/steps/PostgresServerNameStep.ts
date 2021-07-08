/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNameStep, ResourceGroupListStep, resourceGroupNamingRules } from 'vscode-azureextensionui';
import { ext } from '../../../../extensionVariables';
import { PostgreSQLManagementClient } from '@azure/arm-postgresql';
import { NameAvailability, NameAvailabilityRequest } from '@azure/arm-postgresql/src/models';
import { AzureNameStep, createAzureClient, ResourceGroupListStep, resourceGroupNamingRules } from 'vscode-azureextensionui';
import { localize } from '../../../../utils/localize';
import { nonNullProp } from '../../../../utils/nonNull';
import { AbstractPostgresClient, createAbstractPostgresClient } from '../../../abstract/AbstractPostgresClient';
import { AbstractNameAvailability } from '../../../abstract/models';
import { IPostgresServerWizardContext } from '../IPostgresServerWizardContext';

export class PostgresServerNameStep extends AzureNameStep<IPostgresServerWizardContext> {

    public async prompt(context: IPostgresServerWizardContext): Promise<void> {
        const client = createAbstractPostgresClient(nonNullProp(context, "serverType"), context);
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

async function validatePostgresServerName(name: string, client: AbstractPostgresClient): Promise<string | undefined> {
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

    const availability: AbstractNameAvailability = await client.checkNameAvailability.execute({name: name, type: "Microsoft.DBforPostgreSQL"});

    if (!availability.nameAvailable) {
        return localize('serverNameAvailabilityCheck', 'Server name "{0}" is not available.', name);
    }

    return undefined;

}
