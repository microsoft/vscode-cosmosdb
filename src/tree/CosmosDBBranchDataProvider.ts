/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import { type BranchDataProvider } from '@microsoft/vscode-azureresources-api';
import * as vscode from 'vscode';
import { API, tryGetExperience } from '../AzureDBExperiences';
import { databaseAccountType } from '../constants';
import { ext } from '../extensionVariables';
import { nonNullProp } from '../utils/nonNull';
import { type CosmosAccountModel, type CosmosDBResource } from './CosmosAccountModel';
import { type CosmosDbTreeElement } from './CosmosDbTreeElement';
import { DocumentDBAccountResourceItem } from './DocumentDBAccountResourceItem';
import { GraphAccountResourceItem } from './graph/GraphAccountResourceItem';
import { MongoAccountResourceItem } from './mongo/MongoAccountResourceItem';
import { NoSqlAccountResourceItem } from './nosql/NoSqlAccountResourceItem';
import { TableAccountResourceItem } from './table/TableAccountResourceItem';

export class CosmosDBBranchDataProvider
    extends vscode.Disposable
    implements BranchDataProvider<CosmosDBResource, CosmosDbTreeElement>
{
    private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<CosmosDbTreeElement | undefined>();

    constructor() {
        super(() => this.onDidChangeTreeDataEmitter.dispose());
    }

    get onDidChangeTreeData(): vscode.Event<CosmosDbTreeElement | undefined> {
        return this.onDidChangeTreeDataEmitter.event;
    }

    /**
     * This function is called for every element in the tree when expanding, the element being expanded is being passed as an argument
     */
    async getChildren(element: CosmosDbTreeElement): Promise<CosmosDbTreeElement[]> {
        const result = await callWithTelemetryAndErrorHandling(
            'CosmosDBBranchDataProvider.getChildren',
            async (context: IActionContext) => {
                const elementTreeItem = await element.getTreeItem();

                context.telemetry.properties.parentContext = elementTreeItem.contextValue ?? 'unknown';

                return (await element.getChildren?.())?.map((child) => {
                    return ext.state.wrapItemInStateHandling(child, (child: CosmosDbTreeElement) =>
                        this.refresh(child),
                    ) as CosmosDbTreeElement;
                });
            },
        );

        return result ?? [];
    }

    /**
     * This function is being called when the resource tree is being built, it is called for every top level of resources.
     * @param resource
     */
    async getResourceItem(resource: CosmosDBResource): Promise<CosmosDbTreeElement> {
        const resourceItem = await callWithTelemetryAndErrorHandling(
            'CosmosDBBranchDataProvider.getResourceItem',
            async (context: IActionContext) => {
                const id = nonNullProp(resource, 'id');
                const name = nonNullProp(resource, 'name');
                const type = nonNullProp(resource, 'type');

                context.valuesToMask.push(id);
                context.valuesToMask.push(name);

                if (type.toLocaleLowerCase() === databaseAccountType.toLocaleLowerCase()) {
                    const accountModel = resource as CosmosAccountModel;
                    const experience = tryGetExperience(resource);

                    if (experience?.api === API.MongoDB) {
                        return new MongoAccountResourceItem(accountModel, experience);
                    }

                    if (experience?.api === API.Cassandra) {
                        return new DocumentDBAccountResourceItem(accountModel, experience);
                    }

                    if (experience?.api === API.Core) {
                        return new NoSqlAccountResourceItem(accountModel, experience);
                    }

                    if (experience?.api === API.Graph) {
                        return new GraphAccountResourceItem(accountModel, experience);
                    }

                    if (experience?.api === API.Table) {
                        return new TableAccountResourceItem(accountModel, experience);
                    }

                    // Unknown experience
                } else {
                    // Unknown resource type
                }

                return null as unknown as CosmosDbTreeElement;
            },
        );

        if (resourceItem) {
            return ext.state.wrapItemInStateHandling(resourceItem, (item: CosmosDbTreeElement) =>
                this.refresh(item),
            ) as CosmosDbTreeElement;
        }

        return null as unknown as CosmosDbTreeElement;
    }

    async getTreeItem(element: CosmosDbTreeElement): Promise<vscode.TreeItem> {
        return element.getTreeItem();
    }

    refresh(element?: CosmosDbTreeElement): void {
        this.onDidChangeTreeDataEmitter.fire(element);
    }
}