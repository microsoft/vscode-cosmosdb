/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNameStep, createAzureClient, ResourceGroupListStep, resourceGroupNamingRules } from 'vscode-azureextensionui';
import { ext } from '../../../../extensionVariables';
import { localize } from '../../../../utils/localize';
import { nonNullProp } from '../../../../utils/nonNull';
import { AbstractPostgresClient } from '../../../abstract/AbstractPostgresClient';
import { AbstractNameAvailability, PostgresServerType } from '../../../abstract/models';
import { IPostgresServerWizardContext } from '../IPostgresServerWizardContext';

export class PostgresServerNameStep extends AzureNameStep<IPostgresServerWizardContext> {

    public async prompt(wizardContext: IPostgresServerWizardContext): Promise<void> {
        const client = createAzureClient(wizardContext, AbstractPostgresClient);
        wizardContext.newServerName = (await ext.ui.showInputBox({
            placeHolder: localize('serverNamePlaceholder', 'Server name'),
            prompt: localize('enterServerNamePrompt', 'Provide a name for the PostgreSQL Server.'),
            validateInput: (name: string) => validatePostgresServerName(name, client, nonNullProp(wizardContext, "serverType"))
        })).trim();
        wizardContext.valuesToMask.push(wizardContext.newServerName);
        wizardContext.relatedNameTask = this.generateRelatedName(wizardContext, wizardContext.newServerName, resourceGroupNamingRules);
    }

    public shouldPrompt(wizardContext: IPostgresServerWizardContext): boolean {
        return !wizardContext.newServerName;
    }

    protected async isRelatedNameAvailable(wizardContext: IPostgresServerWizardContext, name: string): Promise<boolean> {
        return await ResourceGroupListStep.isNameAvailable(wizardContext, name);
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

    const availability: AbstractNameAvailability = (await client.checkNameAvailability(serverType, name));

    if (!availability.nameAvailable) {
        if (availability.reason === 'AlreadyExists') {
            return localize('serverNameAvailabilityCheck', 'A server named "{0}" already exists.', name);
        }
    }

    return undefined;

}
