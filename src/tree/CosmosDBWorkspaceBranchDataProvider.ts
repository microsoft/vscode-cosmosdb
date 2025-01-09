/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    callWithTelemetryAndErrorHandling,
    createGenericElement,
    type IActionContext,
    parseError,
} from '@microsoft/vscode-azext-utils';
import { type BranchDataProvider } from '@microsoft/vscode-azureresources-api';
import * as vscode from 'vscode';
import { ext } from '../extensionVariables';
import { localize } from '../utils/localize';
import { type CosmosDBResource } from './CosmosAccountModel';
import { type CosmosDBTreeElement } from './CosmosDBTreeElement';
import { CosmosDBAttachedAccountsResourceItem } from './attached/CosmosDBAttachedAccountsResourceItem';

export class CosmosDBWorkspaceBranchDataProvider
    extends vscode.Disposable
    implements BranchDataProvider<CosmosDBResource, CosmosDBTreeElement>
{
    private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<CosmosDBTreeElement | undefined>();

    constructor() {
        super(() => this.onDidChangeTreeDataEmitter.dispose());
    }

    get onDidChangeTreeData(): vscode.Event<CosmosDBTreeElement | undefined> {
        return this.onDidChangeTreeDataEmitter.event;
    }

    /**
     * This function is called for every element in the tree when expanding, the element being expanded is being passed as an argument
     */
    async getChildren(element: CosmosDBTreeElement): Promise<CosmosDBTreeElement[]> {
        try {
            const result = await callWithTelemetryAndErrorHandling(
                'CosmosDBWorkspaceBranchDataProvider.getChildren',
                async (context: IActionContext) => {
                    context.telemetry.properties.view = 'workspace';

                    return (await element.getChildren?.())?.map((child) => {
                        return ext.state.wrapItemInStateHandling(child, (child: CosmosDBTreeElement) =>
                            this.refresh(child),
                        ) as CosmosDBTreeElement;
                    });
                },
            );

            return result ?? [];
        } catch (error) {
            return [
                createGenericElement({
                    contextValue: 'cosmosDB.workspace.item.error',
                    label: localize('Error: {0}', parseError(error).message),
                }) as CosmosDBTreeElement,
            ];
        }
    }

    /**
     * This function is being called when the resource tree is being built, it is called for every top level of resources.
     */
    async getResourceItem(): Promise<CosmosDBTreeElement> {
        const resourceItem = await callWithTelemetryAndErrorHandling(
            'CosmosDBWorkspaceBranchDataProvider.getResourceItem',
            () => new CosmosDBAttachedAccountsResourceItem(),
        );

        if (resourceItem) {
            return ext.state.wrapItemInStateHandling(resourceItem, (item: CosmosDBTreeElement) =>
                this.refresh(item),
            ) as CosmosDBTreeElement;
        }

        return null as unknown as CosmosDBTreeElement;
    }

    async getTreeItem(element: CosmosDBTreeElement): Promise<vscode.TreeItem> {
        return element.getTreeItem();
    }

    refresh(element?: CosmosDBTreeElement): void {
        this.onDidChangeTreeDataEmitter.fire(element);
    }
}
