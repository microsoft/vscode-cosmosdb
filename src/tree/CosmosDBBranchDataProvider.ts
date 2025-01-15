/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    callWithTelemetryAndErrorHandling,
    createGenericElement,
    parseError,
    type IActionContext,
} from '@microsoft/vscode-azext-utils';
import { type BranchDataProvider } from '@microsoft/vscode-azureresources-api';
import * as vscode from 'vscode';
import { API, CoreExperience, tryGetExperience } from '../AzureDBExperiences';
import { databaseAccountType } from '../constants';
import { ext } from '../extensionVariables';
import { localize } from '../utils/localize';
import { nonNullProp } from '../utils/nonNull';
import { type CosmosAccountModel, type CosmosDBResource } from './CosmosAccountModel';
import { type CosmosDBTreeElement } from './CosmosDBTreeElement';
import { GraphAccountResourceItem } from './graph/GraphAccountResourceItem';
import { MongoAccountResourceItem } from './mongo/MongoAccountResourceItem';
import { NoSqlAccountResourceItem } from './nosql/NoSqlAccountResourceItem';
import { TableAccountResourceItem } from './table/TableAccountResourceItem';
import { isTreeElementWithContextValue } from './TreeElementWithContextValue';
import { isTreeElementWithExperience } from './TreeElementWithExperience';

export class CosmosDBBranchDataProvider
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
                'CosmosDBBranchDataProvider.getChildren',
                async (context: IActionContext) => {
                    context.errorHandling.suppressDisplay = true;
                    context.errorHandling.rethrow = true;
                    context.errorHandling.forceIncludeInReportIssueCommand = true;

                    if (isTreeElementWithContextValue(element)) {
                        context.telemetry.properties.parentContext = element.contextValue;
                    }

                    if (isTreeElementWithExperience(element)) {
                        context.telemetry.properties.experience = element.experience?.api ?? API.Common;
                    }

                    // TODO: values to mask. New TreeElements do not have valueToMask field
                    // I assume this array should be filled after element.getChildren() call
                    // And these values should be masked in the context

                    const children = (await element.getChildren?.()) ?? [];
                    return children.map((child) => {
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
                    contextValue: 'cosmosDB.item.error',
                    label: localize('Error: {0}', parseError(error).message),
                }) as CosmosDBTreeElement,
            ];
        }
    }

    /**
     * This function is being called when the resource tree is being built, it is called for every top level of resources.
     * @param resource
     */
    async getResourceItem(resource: CosmosDBResource): Promise<CosmosDBTreeElement> {
        const resourceItem = await callWithTelemetryAndErrorHandling(
            'CosmosDBBranchDataProvider.getResourceItem',
            (context: IActionContext) => {
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
                        return new NoSqlAccountResourceItem(accountModel, experience);
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

                    // Unknown experience fallback
                    return new NoSqlAccountResourceItem(accountModel, CoreExperience);
                } else {
                    // Unknown resource type
                }

                return null as unknown as CosmosDBTreeElement;
            },
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
