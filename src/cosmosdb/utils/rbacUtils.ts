/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type SqlRoleAssignmentCreateUpdateParameters } from '@azure/arm-cosmosdb';
import { createAuthorizationManagementClient, getResourceGroupFromId } from '@microsoft/vscode-azext-azureutils';
import {
    callWithTelemetryAndErrorHandling,
    createSubscriptionContext,
    type IActionContext,
    type IAzureMessageOptions,
} from '@microsoft/vscode-azext-utils';
import { type AzureSubscription } from '@microsoft/vscode-azureresources-api';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { createCosmosDBManagementClient } from '../../utils/azureClients';
import { getDatabaseAccountNameFromId } from '../../utils/azureUtils';
import {
    COSMOS_DB_DATA_CONTRIBUTOR_ROLE_DEFINITION_ID,
    COSMOS_DB_OPERATOR_ROLE_DEFINITION_ID,
} from '../cosmosdb-shared-constants';

export async function ensureRbacPermissionV2(
    fullId: string,
    subscription: AzureSubscription,
    principalId: string,
): Promise<boolean> {
    return (
        (await callWithTelemetryAndErrorHandling('cosmosDB.addMissingRbacRole', async (context: IActionContext) => {
            context.errorHandling.suppressDisplay = false;
            context.errorHandling.rethrow = false;

            const accountName: string = getDatabaseAccountNameFromId(fullId);
            if (await askForRbacPermissions(accountName, subscription.name, context)) {
                context.telemetry.properties.lastStep = 'addRbacContributorPermission';
                const resourceGroup: string = getResourceGroupFromId(fullId);
                const start: number = Date.now();
                await addRbacContributorPermission(accountName, principalId, resourceGroup, context, subscription);
                //send duration of the previous call (in seconds) in addition to the duration of the whole event including user prompt
                context.telemetry.measurements['createRoleAssignment'] = (Date.now() - start) / 1000;

                return true;
            }
            return false;
        })) ?? false
    );
}

export function isRbacException(error: Error): boolean {
    return (
        error instanceof Error && error.message.includes('does not have required RBAC permissions to perform action')
    );
}

export async function showRbacPermissionError(accountName: string, principalId?: string): Promise<void> {
    const message = principalId
        ? l10n.t(
              'You do not have the required permissions to access [{accountName}] with your principal Id [{principalId}].',
              { accountName, principalId },
          ) +
          '\n' +
          l10n.t('Please contact the account owner to get the required permissions.')
        : l10n.t('You do not have the required permissions to access [{accountName}].', { accountName }) +
          '\n' +
          l10n.t('Please contact the account owner to get the required permissions.');
    const readMoreItem = l10n.t('Learn more');
    await vscode.window.showErrorMessage(message, { modal: false }, readMoreItem).then((item) => {
        if (item === readMoreItem) {
            void vscode.env.openExternal(vscode.Uri.parse('https://aka.ms/cosmos-native-rbac'));
        }
    });
}

async function askForRbacPermissions(
    databaseAccount: string,
    subscription: string,
    context: IActionContext,
): Promise<boolean> {
    const message =
        l10n.t(
            "You need the 'Data Contributor' RBAC role permission to enable all Azure Cosmos DB Extension features for the selected account.",
        ) +
        '\n\n' +
        l10n.t('Account Name: {name}', { name: databaseAccount }) +
        '\n' +
        l10n.t('Subscription: {id}', { id: subscription }) +
        '\n';
    const options: IAzureMessageOptions = {
        modal: true,
        detail: message,
        learnMoreLink: 'https://aka.ms/cosmos-native-rbac',
        stepName: 'askSetRbac',
    };
    const setPermissionItem: vscode.MessageItem = {
        title: l10n.t('Extend RBAC permissions'),
    };

    const result = await context.ui.showWarningMessage(
        l10n.t('No required RBAC permissions'),
        options,
        setPermissionItem,
    );
    return result === setPermissionItem;
}

export async function addRbacContributorPermission(
    databaseAccount: string,
    principalId: string,
    resourceGroup: string,
    context: IActionContext,
    subscription: AzureSubscription,
): Promise<string | undefined> {
    const defaultRoleId = COSMOS_DB_DATA_CONTRIBUTOR_ROLE_DEFINITION_ID;
    const fullAccountId = `/subscriptions/${subscription.subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.DocumentDB/databaseAccounts/${databaseAccount}`;

    const createUpdateSqlRoleAssignmentParameters: SqlRoleAssignmentCreateUpdateParameters = {
        principalId: principalId,
        roleDefinitionId: fullAccountId + '/sqlRoleDefinitions/' + defaultRoleId,
        scope: fullAccountId,
    };

    const roleAssignmentId = globalThis.crypto.randomUUID();
    const client = await createCosmosDBManagementClient(context, subscription);
    const create = await client.sqlResources.beginCreateUpdateSqlRoleAssignmentAndWait(
        roleAssignmentId,
        resourceGroup,
        databaseAccount,
        createUpdateSqlRoleAssignmentParameters,
    );

    return create.id;
}

/**
 * Returns true when `principalId` already holds the built-in
 * "Cosmos DB Built-in Data Contributor" role on the given account.
 *
 * Lists existing data-plane role assignments and matches by principal +
 * role definition ID. Used to skip a redundant create call when reusing
 * an existing account during provisioning.
 */
export async function hasDataContributorRoleAssignment(
    databaseAccount: string,
    principalId: string,
    resourceGroup: string,
    context: IActionContext,
    subscription: AzureSubscription,
): Promise<boolean> {
    const fullAccountId = `/subscriptions/${subscription.subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.DocumentDB/databaseAccounts/${databaseAccount}`;
    const expectedRoleDefinitionId = `${fullAccountId}/sqlRoleDefinitions/${COSMOS_DB_DATA_CONTRIBUTOR_ROLE_DEFINITION_ID}`;
    const client = await createCosmosDBManagementClient(context, subscription);

    for await (const assignment of client.sqlResources.listSqlRoleAssignments(resourceGroup, databaseAccount)) {
        if (
            assignment.principalId === principalId &&
            assignment.roleDefinitionId?.toLowerCase() === expectedRoleDefinitionId.toLowerCase()
        ) {
            return true;
        }
    }
    return false;
}

/**
 * Assigns the built-in "Cosmos DB Operator" Azure RBAC role to the given
 * principal at the **resource group** scope, granting the principal the ability
 * to manage Cosmos DB accounts in that resource group — including creating,
 * updating, and deleting databases and containers via the Cosmos DB SDK —
 * without access to keys or data.
 *
 * This role is required in addition to the data-plane "Cosmos DB Built-in Data
 * Contributor" role: Cosmos DB's native RBAC does not expose a data action for
 * database/container lifecycle, so those operations are authorized by Azure
 * RBAC instead. See:
 * https://learn.microsoft.com/azure/cosmos-db/how-to-connect-role-based-access-control?pivots=azure-cli#permission-model
 *
 * Returns the new role assignment ID, or `undefined` when the principal already
 * holds this role at the same scope (treated as success).
 */
export async function addCosmosDBOperatorRoleAssignment(
    principalId: string,
    resourceGroup: string,
    context: IActionContext,
    subscription: AzureSubscription,
): Promise<string | undefined> {
    const resourceGroupScope = `/subscriptions/${subscription.subscriptionId}/resourceGroups/${resourceGroup}`;
    const roleDefinitionId = `/subscriptions/${subscription.subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/${COSMOS_DB_OPERATOR_ROLE_DEFINITION_ID}`;

    const subContext = createSubscriptionContext(subscription);
    const authClient = await createAuthorizationManagementClient([context, subContext]);

    try {
        const result = await authClient.roleAssignments.create(resourceGroupScope, globalThis.crypto.randomUUID(), {
            principalId,
            roleDefinitionId,
            // Setting principalType avoids the 1-minute retry loop that ARM uses when
            // it has to look up the principal type via Microsoft Graph.
            principalType: 'User',
        });
        return result.id;
    } catch (error) {
        // The assignment already exists — Azure returns 409 RoleAssignmentExists.
        // Treat as success since the desired state is already in place.
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('RoleAssignmentExists')) {
            return undefined;
        }
        throw error;
    }
}

/**
 * Returns true when `principalId` already holds the built-in
 * "Cosmos DB Operator" Azure RBAC role at the given resource group scope
 * (or inherited from a parent scope, e.g. the subscription).
 *
 * Used to skip a redundant create call when reusing an existing account.
 */
export async function hasCosmosDBOperatorRoleAssignment(
    principalId: string,
    resourceGroup: string,
    context: IActionContext,
    subscription: AzureSubscription,
): Promise<boolean> {
    const resourceGroupScope = `/subscriptions/${subscription.subscriptionId}/resourceGroups/${resourceGroup}`;
    const expectedRoleDefinitionSuffix = `/providers/Microsoft.Authorization/roleDefinitions/${COSMOS_DB_OPERATOR_ROLE_DEFINITION_ID}`;

    const subContext = createSubscriptionContext(subscription);
    const authClient = await createAuthorizationManagementClient([context, subContext]);

    // `atScope()` returns assignments at this scope or any parent scope so we
    // also detect roles inherited from the subscription/management group.
    for await (const assignment of authClient.roleAssignments.listForScope(resourceGroupScope, {
        filter: `atScope() and assignedTo('${principalId}')`,
    })) {
        if (assignment.roleDefinitionId?.toLowerCase().endsWith(expectedRoleDefinitionSuffix.toLowerCase())) {
            return true;
        }
    }
    return false;
}
