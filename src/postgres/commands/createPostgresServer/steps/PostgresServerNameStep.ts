/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ResourceGroupListStep, resourceGroupNamingRules } from '@microsoft/vscode-azext-azureutils';
import { AzureNameStep } from '@microsoft/vscode-azext-utils';
import { localize } from '../../../../utils/localize';
import { nonNullProp } from '../../../../utils/nonNull';
import { AbstractPostgresClient, createAbstractPostgresClient } from '../../../abstract/AbstractPostgresClient';
import { AbstractNameAvailability, PostgresServerType } from '../../../abstract/models';
import { IPostgresServerWizardContext } from '../IPostgresServerWizardContext';

export class PostgresServerNameStep extends AzureNameStep<IPostgresServerWizardContext> {

    public async prompt(context: IPostgresServerWizardContext): Promise<void> {
        const client = await createAbstractPostgresClient(nonNullProp(context, "serverType"), context);
        context.newServerName = (await context.ui.showInputBox({
            placeHolder: localize('serverNamePlaceholder', 'Server name'),
            prompt: localize('enterServerNamePrompt', 'Provide a name for the PostgreSQL Server.'),
            validateInput: (name: string) => validatePostgresServerName(name, client, nonNullProp(context, "serverType"))
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

async function validatePostgresServerName(name: string, client: AbstractPostgresClient, serverType: PostgresServerType): Promise<string | undefined> {
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
    const resourceType = serverType === PostgresServerType.Single ? "Microsoft.DBforPostgreSQL" : "Microsoft.DBforPostgreSQL/flexibleServers";
    const availability: AbstractNameAvailability = await client.checkNameAvailability.execute({ name: name, type: resourceType });

    if (!availability.nameAvailable) {
        return availability.message ?
            availability.message :
            localize('serverNameAvailabilityCheck', 'Server name "{0}" is not available.', name);
    }

    return undefined;

}
