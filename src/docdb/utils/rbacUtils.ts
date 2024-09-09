/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SqlRoleAssignmentCreateUpdateParameters } from '@azure/arm-cosmosdb';
import { getResourceGroupFromId } from '@microsoft/vscode-azext-azureutils';
import { callWithTelemetryAndErrorHandling, IActionContext, IAzureMessageOptions, ISubscriptionContext } from '@microsoft/vscode-azext-utils';
import { randomUUID } from 'crypto';
import * as vscode from 'vscode';
import { createCosmosDBClient } from '../../utils/azureClients';
import { getDatabaseAccountNameFromId } from '../../utils/azureUtils';
import { localize } from '../../utils/localize';
import { DocDBAccountTreeItemBase } from '../tree/DocDBAccountTreeItemBase';

export async function ensureRbacPermission(docDbItem: DocDBAccountTreeItemBase, principalId: string): Promise<boolean> {
    return await callWithTelemetryAndErrorHandling('cosmosDB.addMissingRbacRole', async (context: IActionContext) => {

        context.errorHandling.suppressDisplay = false;
        context.errorHandling.rethrow = false;

        const accountName: string = getDatabaseAccountNameFromId(docDbItem.fullId);
        if (await askForRbacPermissions(accountName, docDbItem.subscription.subscriptionDisplayName, context)) {
            context.telemetry.properties.lastStep = "addRbacContributorPermission";
            const resourceGroup: string = getResourceGroupFromId(docDbItem.fullId);
            const start: number = Date.now();
            await addRbacContributorPermission(accountName, principalId, resourceGroup, context, docDbItem.subscription);
            //send duration of the previous call (in seconds) in addition to the duration of the whole event including user prompt
            context.telemetry.measurements["createRoleAssignment"] = (Date.now() - start) / 1000;

            return true;
        }
        return false;
    }) ?? false;
}

export function isRbacException(error: Error): boolean {
    return (error instanceof Error && error.message.includes("does not have required RBAC permissions to perform action"));
}

export async function showRbacPermissionError(accountName: string, principalId: string): Promise<void> {
    const message = localize("rbacPermissionErrorMsg", "You do not have the required permissions to access [{0}] with your principal Id [{1}].\nPlease contact the account owner to get the required permissions.", accountName, principalId);
    const readMoreItem = localize("learnMore", "Learn More");
    await vscode.window.showErrorMessage(message, { modal: false }, ...[readMoreItem]).then((item) => {
        if (item === readMoreItem) {
            void vscode.env.openExternal(vscode.Uri.parse("https://aka.ms/cosmos-native-rbac"));
        }
    });
}

async function askForRbacPermissions(databaseAccount: string, subscription: string, context: IActionContext): Promise<boolean> {
    const message =
        [localize("rbacMissingErrorMsg", "You need the 'Data Contributor' RBAC role permission to enable all Azure Databases Extension features for the selected account.\n\n"),
        localize("rbacMissingErrorAccountName", "Account Name: {0}\n", databaseAccount),
        localize("rbacMissingErrorSubscriptionName", "Subscription: {0}\n", subscription)
        ].join("");
    const options: IAzureMessageOptions = { modal: true, detail: message, learnMoreLink: "https://aka.ms/cosmos-native-rbac", stepName: "askSetRbac" };
    const setPermissionItem: vscode.MessageItem = { title: localize("rbacExtendPermissionBtn", "Extend RBAC permissions") };

    const result = await context.ui.showWarningMessage(localize("rbacMissingErrorTitle", "No required RBAC permissions"), options, ...[setPermissionItem]);
    return result === setPermissionItem;
}

async function addRbacContributorPermission(databaseAccount: string, principalId: string, resourceGroup: string, context: IActionContext, subscription: ISubscriptionContext): Promise<string | undefined> {
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

