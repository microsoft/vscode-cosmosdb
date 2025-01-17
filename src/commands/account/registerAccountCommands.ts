/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    type AzExtTreeItem,
    type IActionContext,
    type ITreeItemPickerContext,
    registerCommandWithTreeNodeUnwrapping,
} from '@microsoft/vscode-azext-utils';
import { platform } from 'os';
import vscode from 'vscode';
import { cosmosGremlinFilter, cosmosMongoFilter, cosmosTableFilter, sqlFilter } from '../../constants';
import { DocDBAccountTreeItem } from '../../docdb/tree/DocDBAccountTreeItem';
import { type DocDBAccountTreeItemBase } from '../../docdb/tree/DocDBAccountTreeItemBase';
import { ext } from '../../extensionVariables';
import { GraphAccountTreeItem } from '../../graph/tree/GraphAccountTreeItem';
import { setConnectedNode } from '../../mongo/setConnectedNode';
import { MongoAccountTreeItem } from '../../mongo/tree/MongoAccountTreeItem';
import { TableAccountTreeItem } from '../../table/tree/TableAccountTreeItem';
import { AttachedAccountSuffix } from '../../tree/AttachedAccountsTreeItem';
import { SubscriptionTreeItem } from '../../tree/SubscriptionTreeItem';
import { localize } from '../../utils/localize';
import { deleteDatabaseAccount } from '../deleteDatabaseAccount/deleteDatabaseAccount';
import { copyConnectionString } from './copyConnectionString';

const cosmosDBTopLevelContextValues: string[] = [
    GraphAccountTreeItem.contextValue,
    DocDBAccountTreeItem.contextValue,
    TableAccountTreeItem.contextValue,
    MongoAccountTreeItem.contextValue,
];

export function registerAccountCommands() {
    registerCommandWithTreeNodeUnwrapping('azureDatabases.createServer', createServer);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.deleteAccount', deleteAccount);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.attachDatabaseAccount', async (actionContext: IActionContext) => {
        await ext.attachedAccountsNode.attachNewAccount(actionContext);
        await ext.rgApi.workspaceResourceTree.refresh(actionContext, ext.attachedAccountsNode);
    });
    registerCommandWithTreeNodeUnwrapping('cosmosDB.attachEmulator', async (actionContext: IActionContext) => {
        if (platform() !== 'win32') {
            actionContext.errorHandling.suppressReportIssue = true;
            throw new Error(localize('emulatorNotSupported', 'The Cosmos DB emulator is only supported on Windows.'));
        }

        await ext.attachedAccountsNode.attachEmulator(actionContext);
        await ext.rgApi.workspaceResourceTree.refresh(actionContext, ext.attachedAccountsNode);
    });
    registerCommandWithTreeNodeUnwrapping(
        'azureDatabases.detachDatabaseAccount',
        async (actionContext: IActionContext & ITreeItemPickerContext, node?: AzExtTreeItem) => {
            const children = await ext.attachedAccountsNode.loadAllChildren(actionContext);
            if (children.length < 2) {
                const message = localize('noAttachedAccounts', 'There are no Attached Accounts.');
                void vscode.window.showInformationMessage(message);
            } else {
                if (!node) {
                    node = await ext.rgApi.workspaceResourceTree.showTreeItemPicker<AzExtTreeItem>(
                        cosmosDBTopLevelContextValues.map((val: string) => (val += AttachedAccountSuffix)),
                        actionContext,
                    );
                }
                if (node instanceof MongoAccountTreeItem) {
                    if (ext.connectedMongoDB && node.fullId === ext.connectedMongoDB.parent.fullId) {
                        setConnectedNode(undefined);
                        await node.refresh(actionContext);
                    }
                }
                await ext.attachedAccountsNode.detach(node);
                await ext.rgApi.workspaceResourceTree.refresh(actionContext, ext.attachedAccountsNode);
            }
        },
    );
    registerCommandWithTreeNodeUnwrapping('cosmosDB.copyConnectionString', copyConnectionString);
}

export async function createServer(context: IActionContext, node?: SubscriptionTreeItem): Promise<void> {
    if (!node) {
        node = await ext.rgApi.appResourceTree.showTreeItemPicker<SubscriptionTreeItem>(
            SubscriptionTreeItem.contextValue,
            context,
        );
    }

    await SubscriptionTreeItem.createChild(context, node);
}

export async function deleteAccount(context: IActionContext, node?: AzExtTreeItem): Promise<void> {
    const suppressCreateContext: ITreeItemPickerContext = context;
    suppressCreateContext.suppressCreatePick = true;
    if (!node) {
        node = await ext.rgApi.pickAppResource<AzExtTreeItem>(context, {
            filter: [cosmosMongoFilter, cosmosTableFilter, cosmosGremlinFilter, sqlFilter],
        });
    }

    await deleteDatabaseAccount(context, node, false);
}
