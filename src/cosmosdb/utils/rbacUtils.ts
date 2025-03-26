/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type SqlRoleAssignmentCreateUpdateParameters } from '@azure/arm-cosmosdb';
import { getResourceGroupFromId } from '@microsoft/vscode-azext-azureutils';
import {
    callWithTelemetryAndErrorHandling,
    createSubscriptionContext,
    type IActionContext,
    type IAzureMessageOptions,
    type ISubscriptionContext,
} from '@microsoft/vscode-azext-utils';
import { type AzureSubscription } from '@microsoft/vscode-azureresources-api';
import * as l10n from '@vscode/l10n';
import { randomUUID } from 'crypto';
import * as vscode from 'vscode';
import { createCosmosDBClient } from '../../utils/azureClients';
import { getDatabaseAccountNameFromId } from '../../utils/azureUtils';

export async function ensureRbacPermissionV2(
    fullId: string,
    subscription: AzureSubscription,
    principalId: string,
): Promise<boolean> {
    return (
        (await callWithTelemetryAndErrorHandling('cosmosDB.addMissingRbacRole', async (context: IActionContext) => {
            context.errorHandling.suppressDisplay = false;
            context.errorHandling.rethrow = false;

            const subscriptionContext = createSubscriptionContext(subscription);
            const accountName: string = getDatabaseAccountNameFromId(fullId);
            if (await askForRbacPermissions(accountName, subscriptionContext.subscriptionDisplayName, context)) {
                context.telemetry.properties.lastStep = 'addRbacContributorPermission';
                const resourceGroup: string = getResourceGroupFromId(fullId);
                const start: number = Date.now();
                await addRbacContributorPermission(
                    accountName,
                    principalId,
                    resourceGroup,
                    context,
                    subscriptionContext,
                );
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
    await vscode.window.showErrorMessage(message, { modal: false }, ...[readMoreItem]).then((item) => {
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
            "You need the 'Data Contributor' RBAC role permission to enable all Azure Databases Extension features for the selected account.",
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
        ...[setPermissionItem],
    );
    return result === setPermissionItem;
}

async function addRbacContributorPermission(
    databaseAccount: string,
    principalId: string,
    resourceGroup: string,
    context: IActionContext,
    subscription: ISubscriptionContext,
): Promise<string | undefined> {
    const defaultRoleId = '00000000-0000-0000-0000-000000000002'; // this is a predefined role with read and write access to data plane resources
    const fullAccountId = `/subscriptions/${subscription.subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.DocumentDB/databaseAccounts/${databaseAccount}`;

    const createUpdateSqlRoleAssignmentParameters: SqlRoleAssignmentCreateUpdateParameters = {
        principalId: principalId,
        roleDefinitionId: fullAccountId + '/sqlRoleDefinitions/' + defaultRoleId,
        scope: fullAccountId,
    };

    /*
    // TODO: find a better way to check if a role assignment for the current user already exists,
    // iterating over all role assignments and definitions is not efficient.
    const rbac = client.sqlResources.listSqlRoleAssignments(resourceGroup, databaseAccount)
    for await (const role of rbac) {
        console.log(role);
    }*/

    const roleAssignmentId = randomUUID();
    const client = await createCosmosDBClient([context, subscription]);
    const create = await client.sqlResources.beginCreateUpdateSqlRoleAssignmentAndWait(
        roleAssignmentId,
        resourceGroup,
        databaseAccount,
        createUpdateSqlRoleAssignmentParameters,
    );

    return create.id;
}
