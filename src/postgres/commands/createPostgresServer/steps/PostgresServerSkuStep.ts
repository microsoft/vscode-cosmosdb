/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { AzureWizardPromptStep, IAzureQuickPickItem } from "vscode-azureextensionui";
import { ext } from "../../../../extensionVariables";
import { localize } from "../../../../utils/localize";
import { nonNullProp } from "../../../../utils/nonNull";
import { openUrl } from "../../../../utils/openUrl";
import { AbstractSku, PostgresServerType } from "../../../abstract/models";
import { IPostgresServerWizardContext } from "../IPostgresServerWizardContext";

interface ISkuOption {
    label: string;
    description: string;
    sku: AbstractSku;
    group?: string;
}

export class PostgresServerSkuStep extends AzureWizardPromptStep<IPostgresServerWizardContext> {
    public async prompt(
        wizardContext: IPostgresServerWizardContext
    ): Promise<void> {
        const placeHolder: string = localize(
            "selectPostgresSku",
            "Select the Postgres SKU and options."
        );
        const pricingTiers: IAzureQuickPickItem<AbstractSku | undefined>[] = await this.getPicks(nonNullProp(wizardContext, 'serverType'));
        pricingTiers.push({
            label: localize('ShowPricingCalculator', '$(link-external) Show pricing information...'),
            onPicked: async () => {
                await openUrl('https://aka.ms/AAcxhvm');
            }, data: undefined
        });

        wizardContext.sku = (await ext.ui.showQuickPick(pricingTiers, { placeHolder, suppressPersistence: true, enableGrouping: true })).data;
    }

    public shouldPrompt(wizardContext: IPostgresServerWizardContext): boolean {
        return wizardContext.sku === undefined;
    }

    public async getPicks(serverType: PostgresServerType): Promise<IAzureQuickPickItem<AbstractSku | undefined>[]> {
        const options: IAzureQuickPickItem<AbstractSku | undefined>[] = [];
        const skuOptions: ISkuOption[] = serverType == PostgresServerType.Single ? singleServerSkus : flexibleServerSkus ;

        skuOptions.forEach((option) => {
            options.push({
                label: option.label,
                description: localize(
                    nonNullProp(option.sku, "name"),
                    option.description
                ),
                data: option.sku,
                group: option.group || localize('addlOptions', 'Additional Options')
            });
        });
        return options;
    }
}

const recommendedGroup = localize('recommendGroup', 'Recommended');
const singleServerSkus: ISkuOption[] = [
    {
        label: "B1",
        description: "Basic, 1 vCore, 2GiB Memory, 5GB storage",
        sku: {
            name: "B_Gen5_1",
            tier: "Basic",
            capacity: 1,
            family: "Gen5",
            size: "5120",
        },
        group: recommendedGroup
    },
    {
        label: "B2",
        description: "Basic, 2 vCores, 4GiB Memory, 50GB storage",
        sku: {
            name: "B_Gen5_2",
            tier: "Basic",
            capacity: 2,
            family: "Gen5",
            size: "51200",
        },
    },
    {
        label: "GP2",
        description: "General Purpose, 2 vCores, 10GiB Memory, 50GB storage",
        sku: {
            name: "GP_Gen5_2",
            tier: "GeneralPurpose",
            capacity: 2,
            family: "Gen5",
            size: "51200",
        },
        group: recommendedGroup
    },
    {
        label: "GP4",
        description: "General Purpose, 4 vCores, 20GiB Memory, 50GB storage",
        sku: {
            name: "GP_Gen5_4",
            tier: "GeneralPurpose",
            capacity: 4,
            family: "Gen5",
            size: "51200",
        },
    },
    {
        label: "GP8",
        description: "General Purpose, 8 vCores, 40GiB Memory, 200GB storage",
        sku: {
            name: "GP_Gen5_8",
            tier: "GeneralPurpose",
            capacity: 8,
            family: "Gen5",
            size: "204800",
        },
    },
    {
        label: "GP16",
        description: "General Purpose, 16 vCores, 80GiB Memory, 200GB storage",
        sku: {
            name: "GP_Gen5_16",
            tier: "GeneralPurpose",
            capacity: 16,
            family: "Gen5",
            size: "204800",
        },
    },
    {
        label: "GP32",
        description: "General Purpose, 32 vCores, 160GiB Memory, 200GB storage",
        sku: {
            name: "GP_Gen5_32",
            tier: "GeneralPurpose",
            capacity: 32,
            family: "Gen5",
            size: "204800",
        },
    },
    {
        label: "GP64",
        description: "General Purpose, 64 vCores, 320GiB Memory, 200GB storage",
        sku: {
            name: "GP_Gen5_64",
            tier: "GeneralPurpose",
            capacity: 64,
            family: "Gen5",
            size: "204800",
        },
    },
];

// Official storage sizes are 32768, 65536, 131072, 262144, 524288, 1048576, 2097152, 4194304, 8388608, 16777216
const flexibleServerSkus: ISkuOption[] = [
    {
        label: "B1ms",
        description: "Basic, 1 vCore, 2GiB Memory, 32GB storage",
        sku: {
            name: "Standard_B1ms",
            tier: "Burstable",
            capacity: 1,
            size: "32768",
        },
        group: recommendedGroup
    },
    {
        label: "B2s",
        description: "Basic, 2 vCore, 4GiB Memory, 32GB storage",
        sku: {
            name: "Standard_B2s",
            tier: "Burstable",
            capacity: 2,
            size: "32768",
        },
    },
];
