/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CosmosDBManagementClient, type DatabaseAccountGetResults } from '@azure/arm-cosmosdb';
import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import { type AzureSubscription } from '@microsoft/vscode-azureresources-api';
import * as l10n from '@vscode/l10n';
import { type CosmosDBAccountModel } from '../tree/cosmosdb/models/CosmosDBAccountModel';
import { createCosmosDBManagementClient } from '../utils/azureClients';
import { nonNullProp } from '../utils/nonNull';
import { SERVERLESS_CAPABILITY_NAME } from './cosmosdb-shared-constants';

/**
 * Recursively makes every property of `T` (and all nested objects/arrays) `readonly`
 * at the type level. Functions are preserved as-is so methods on shapes like
 * `AzureSubscription` remain callable.
 *
 * Note: this is a compile-time guarantee only — it does not call `Object.freeze`.
 */
type DeepReadonly<T> = T extends (...args: never[]) => unknown
    ? T
    : T extends ReadonlyArray<infer U>
      ? ReadonlyArray<DeepReadonly<U>>
      : T extends object
        ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
        : T;

export class AzureResourceMetadata {
    /**
     * This is only one available way to get AzureResourceMetadata, so we require the following props
     * - `account.subscription`
     * - `account.id`
     * - `account.name`
     * - `account.resourceGroup`
     * - `databaseAccount.documentEndpoint`
     *
     * If any of these properties will be undefined, null or empty string, then this function will return undefined.
     * @param account
     */
    public static async create(account: CosmosDBAccountModel): Promise<AzureResourceMetadata | undefined> {
        return callWithTelemetryAndErrorHandling('cosmosDB.getAzureSpecificMetadata', async () => {
            const subscription = nonNullProp(account, 'subscription');
            const accountId = nonNullProp(account, 'id');
            const accountName = nonNullProp(account, 'name');
            const resourceGroup = nonNullProp(account, 'resourceGroup');

            const client = await callWithTelemetryAndErrorHandling(
                'createCosmosDBManagementClient',
                async (context: IActionContext) => {
                    context.telemetry.suppressIfSuccessful = true;
                    context.errorHandling.forceIncludeInReportIssueCommand = true;
                    context.valuesToMask.push(subscription.subscriptionId);
                    return createCosmosDBManagementClient(context, subscription);
                },
            );

            if (!client) {
                throw new Error(l10n.t('Failed to create CosmosDB management client.'));
            }

            const databaseAccount = await client.databaseAccounts.get(resourceGroup, accountName);

            // Database account has to have document endpoint
            nonNullProp(databaseAccount, 'documentEndpoint', `of the database account ${accountId}`);

            return new AzureResourceMetadata(subscription, accountId, accountName, resourceGroup, databaseAccount);
        });
    }

    protected constructor(
        public readonly subscription: DeepReadonly<AzureSubscription>,
        public readonly accountId: string,
        public readonly accountName: string,
        public readonly resourceGroup: string,
        public readonly databaseAccount: DeepReadonly<DatabaseAccountGetResults>,
    ) {
        // The constructor is intentionally simple; all logic is in the static create method
    }

    public get documentEndpoint() {
        return this.databaseAccount.documentEndpoint ?? '';
    }

    public get isServerless(): boolean {
        return this.databaseAccount.capabilities?.some((cap) => cap.name === SERVERLESS_CAPABILITY_NAME) ?? false;
    }

    public getClient(): Promise<CosmosDBManagementClient | undefined> {
        return callWithTelemetryAndErrorHandling('createCosmosDBManagementClient', async (context: IActionContext) => {
            context.telemetry.suppressIfSuccessful = true;
            context.errorHandling.forceIncludeInReportIssueCommand = true;
            context.valuesToMask.push(this.subscription.subscriptionId);
            return createCosmosDBManagementClient(context, this.subscription);
        });
    }
}
