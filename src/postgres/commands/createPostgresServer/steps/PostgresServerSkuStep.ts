/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Sku } from '@azure/arm-postgresql/src/models';
import { AzureWizardPromptStep, IAzureQuickPickItem } from 'vscode-azureextensionui';
import { ext } from '../../../../extensionVariables';
import { localize } from '../../../../utils/localize';
import { nonNullProp } from '../../../../utils/nonNull';
import { IPostgresServerWizardContext } from '../IPostgresServerWizardContext';

interface ISkuOption {
    label: string
    detail: string
    sku: Sku
}

export class PostgresServerSkuStep extends AzureWizardPromptStep<IPostgresServerWizardContext> {
    public async prompt(wizardContext: IPostgresServerWizardContext): Promise<void> {
        const placeHolder: string = localize('selectPostgresSku', 'Select the Postgres SKU and options.');
        wizardContext.sku = (await ext.ui.showQuickPick(this.getPicks(), { placeHolder })).data;
    }

    public shouldPrompt(wizardContext: IPostgresServerWizardContext): boolean {
        return wizardContext.sku === undefined;
    }

    public async getPicks(): Promise<IAzureQuickPickItem<Sku>[]> {
        const options: IAzureQuickPickItem<Sku>[] = [];
        availableSkus.forEach(option => {
            options.push({ label: option.label, description: localize(nonNullProp(option.sku, 'name'), option.detail), data: option.sku });
        });
        return options;
    }
}

const availableSkus: ISkuOption[] = [
    {
        label: "B1",
        detail: "Basic, 1 vCore, 2GiB Memory, 5GB storage",
        sku: {
            name: "B_Gen5_1",
            tier: "Basic",
            capacity: 1,
            family: "Gen5",
            size: "5120"
        }
    },
    {
        label: "B2",
        detail: "Basic, 2 vCores, 4GiB Memory, 50GB storage",
        sku: {
            name: "B_Gen5_2",
            tier: "Basic",
            capacity: 2,
            family: "Gen5",
            size: "51200"
        }
    },
    {
        label: "GP2",
        detail: "General Purpose, 2 vCores, 10GiB Memory, 50GB storage",
        sku: {
            name: "GP_Gen5_2",
            tier: "GeneralPurpose",
            capacity: 2,
            family: "Gen5",
            size: "51200"
        }
    },
    {
        label: "GP4",
        detail: "General Purpose, 4 vCores, 20GiB Memory, 50GB storage",
        sku: {
            name: "GP_Gen5_4",
            tier: "GeneralPurpose",
            capacity: 4,
            family: "Gen5",
            size: "51200"
        }
    },
    {
        label: "GP8",
        detail: "General Purpose, 8 vCores, 40GiB Memory, 200GB storage",
        sku: {
            name: "GP_Gen5_8",
            tier: "GeneralPurpose",
            capacity: 8,
            family: "Gen5",
            size: "204800"
        }
    },
    {
        label: "GP16",
        detail: "General Purpose, 16 vCores, 80GiB Memory, 200GB storage",
        sku: {
            name: "GP_Gen5_16",
            tier: "GeneralPurpose",
            capacity: 16,
            family: "Gen5",
            size: "204800"
        }
    },
    {
        label: "GP32",
        detail: "General Purpose, 32 vCores, 160GiB Memory, 200GB storage",
        sku: {
            name: "GP_Gen5_32",
            tier: "GeneralPurpose",
            capacity: 32,
            family: "Gen5",
            size: "204800"
        }
    },
    {
        label: "GP64",
        detail: "General Purpose, 64 vCores, 320GiB Memory, 200GB storage",
        sku: {
            name: "GP_Gen5_64",
            tier: "GeneralPurpose",
            capacity: 64,
            family: "Gen5",
            size: "204800"
        }
    }
];
