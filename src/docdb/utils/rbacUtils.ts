/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SqlRoleAssignmentCreateUpdateParameters } from '@azure/arm-cosmosdb';
import { getResourceGroupFromId } from '@microsoft/vscode-azext-azureutils';
import { IActionContext, ISubscriptionContext } from '@microsoft/vscode-azext-utils';
import { randomUUID } from 'crypto';
import * as vscode from 'vscode';
import { Uri } from 'vscode';
import { createCosmosDBClient } from '../../utils/azureClients';
import { getDatabaseAccountNameFromId } from '../../utils/azureUtils';
import { DocDBAccountTreeItemBase } from '../tree/DocDBAccountTreeItemBase';

export async function ensureRbacPermission(docDbItem: DocDBAccountTreeItemBase, principalId: string, context: IActionContext): Promise<boolean> {
    const accountName: string = getDatabaseAccountNameFromId(docDbItem.fullId);
    if (await askForRbacPermissions(accountName, docDbItem.subscription.subscriptionDisplayName)) {
        const resourceGroup: string = getResourceGroupFromId(docDbItem.fullId);
        try {
            await addRBACContributorPermission(accountName, principalId, resourceGroup, context, docDbItem.subscription);
            return true;
        } catch (error) {
            // swallow the error, we want the user to reach out to the account owner if this failed
        }
    }
    return false;
}

export function isRbacException(error: Error): boolean {
    return (error instanceof Error && error.message.includes("does not have required RBAC permissions to perform action"));
}

export async function showRBACPermissionError(accountName: string, principalId: string): Promise<void> {
    const message = `You do not have the required permissions to access '${accountName}' with your principal Id '${principalId}'.\nPlease contact the account owner to get the required permissions.`;
    const readMoreItem = "Read More";
    await vscode.window.showErrorMessage(message, { modal: false }, ...[readMoreItem]).then((item) => {
        if (item === readMoreItem) {
            void vscode.env.openExternal(Uri.parse("https://aka.ms/cosmos-native-rbac"));
        }
    });
}

async function askForRbacPermissions(databaseAccount: string, subscription: string): Promise<boolean> {
    const message =
        ["You need the 'Data Contributor' RBAC role to enable all Azure Databases Extension features for the selected account.\n\n",
            "Account Name: ", databaseAccount, "\n",
            "Subscription: ", subscription, "\n"
        ].join("");
    const options: vscode.MessageOptions = { modal: true, detail: message };
    const readMoreItem = "Read More";
    const setPermissionItem = "Extend RBAC permissions";

    const result = await vscode.window.showWarningMessage('No required RBAC permissions', options, ...[setPermissionItem, readMoreItem]);
    if (result === setPermissionItem) {
        return true;
    } else if (result === readMoreItem) {
        void vscode.env.openExternal(Uri.parse("https://aka.ms/cosmos-native-rbac"));
    }
    return false;
}

async function addRBACContributorPermission(databaseAccount: string, principalId: string, resourceGroup: string, context: IActionContext, subscription: ISubscriptionContext): Promise<string | undefined> {
    const defaultRoleId = "00000000-0000-0000-0000-000000000002"; // this is a predefined role with read and write access to data plane resources
    const fullAccountId = `/subscriptions/${subscription.subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.DocumentDB/databaseAccounts/${databaseAccount}`;

    const createUpdateSqlRoleAssignmentParameters: SqlRoleAssignmentCreateUpdateParameters =
    {
        principalId: principalId,
        roleDefinitionId: fullAccountId + "/sqlRoleDefinitions/" + defaultRoleId,
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
    const create = await client.sqlResources.beginCreateUpdateSqlRoleAssignmentAndWait(roleAssignmentId, resourceGroup, databaseAccount, createUpdateSqlRoleAssignmentParameters);

    return create.id;
}

