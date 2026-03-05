/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSCodeAzureSubscriptionProvider, type AzureTenant } from '@microsoft/vscode-azext-azureauth';
import { AzureWizardPromptStep, type IAzureQuickPickItem } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { parseCosmosDBConnectionString } from '../../cosmosdb/cosmosDBConnectionStrings';
import { type NewConnectionWizardContext } from './NewConnectionWizardContext';

/**
 * Prompts the user to select an Azure tenant when the connection string
 * does not include an AccountKey or TenantId. The selected tenant will be
 * used for Entra ID authentication against the Cosmos DB account.
 */
export class CosmosDBTenantStep extends AzureWizardPromptStep<NewConnectionWizardContext> {
    public async prompt(context: NewConnectionWizardContext): Promise<void> {
        const subscriptionProvider = new VSCodeAzureSubscriptionProvider();

        try {
            const isSignedIn = await subscriptionProvider.isSignedIn();
            if (!isSignedIn) {
                await subscriptionProvider.signIn();
            }

            const tenants: AzureTenant[] = await subscriptionProvider.getTenants();

            if (tenants.length === 0) {
                throw new Error(l10n.t('No Azure tenants found. Please sign in to Azure first.'));
            }

            if (tenants.length === 1) {
                // Auto-select if there's only one tenant
                context.tenantId = tenants[0].tenantId;
            } else {
                const picks: IAzureQuickPickItem<string>[] = tenants
                    .filter((tenant): tenant is AzureTenant & { tenantId: string } => !!tenant.tenantId)
                    .map((tenant) => ({
                        label: tenant.displayName ?? tenant.tenantId,
                        description: tenant.tenantId,
                        data: tenant.tenantId,
                    }));

                if (picks.length === 0) {
                    throw new Error(l10n.t('No Azure tenants found. Please sign in to Azure first.'));
                }

                const pick = await context.ui.showQuickPick(picks, {
                    placeHolder: l10n.t('Select an Azure tenant for authentication'),
                    stepName: 'selectTenant',
                });

                context.tenantId = pick.data;
            }

            const tenantId = context.tenantId;
            if (tenantId) {
                context.valuesToMask.push(tenantId);
            }
        } finally {
            subscriptionProvider.dispose();
        }
    }

    public shouldPrompt(context: NewConnectionWizardContext): boolean {
        // Only prompt if we have a connection string but no tenantId and no AccountKey
        if (!context.connectionString || context.tenantId) {
            return false;
        }

        try {
            const parsedCS = parseCosmosDBConnectionString(context.connectionString);
            // Prompt when neither AccountKey nor TenantId was provided in the connection string
            return !parsedCS.masterKey && !parsedCS.tenantId;
        } catch {
            return false;
        }
    }
}
