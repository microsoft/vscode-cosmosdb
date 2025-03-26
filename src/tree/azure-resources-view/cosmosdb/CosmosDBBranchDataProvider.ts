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
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { API, CoreExperience, MongoExperience, tryGetExperience } from '../../../AzureDBExperiences';
import { databaseAccountType } from '../../../constants';
import { ext } from '../../../extensionVariables';
import { nonNullProp } from '../../../utils/nonNull';
import { type CosmosDBAccountModel } from '../../cosmosdb/models/CosmosDBAccountModel';
import { type ClusterModel } from '../../documentdb/ClusterModel';
import { GraphAccountResourceItem } from '../../graph/GraphAccountResourceItem';
import { NoSqlAccountResourceItem } from '../../nosql/NoSqlAccountResourceItem';
import { TableAccountResourceItem } from '../../table/TableAccountResourceItem';
import { type TreeElement } from '../../TreeElement';
import { isTreeElementWithContextValue } from '../../TreeElementWithContextValue';
import { isTreeElementWithExperience } from '../../TreeElementWithExperience';
import { MongoRUResourceItem } from '../documentdb/mongo-ru/MongoRUResourceItem';

export class CosmosDBBranchDataProvider
    extends vscode.Disposable
    implements BranchDataProvider<CosmosDBAccountModel, TreeElement>
{
    private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<TreeElement | undefined>();

    constructor() {
        super(() => this.onDidChangeTreeDataEmitter.dispose());
    }

    get onDidChangeTreeData(): vscode.Event<TreeElement | undefined> {
        return this.onDidChangeTreeDataEmitter.event;
    }

    /**
     * This function is called for every element in the tree when expanding, the element being expanded is being passed as an argument
     */
    async getChildren(element: TreeElement): Promise<TreeElement[]> {
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
                        return ext.state.wrapItemInStateHandling(child, (child: TreeElement) =>
                            this.refresh(child),
                        ) as TreeElement;
                    });
                },
            );

            return result ?? [];
        } catch (error) {
            return [
                createGenericElement({
                    contextValue: 'cosmosDB.item.error',
                    label: l10n.t('Error: {0}', parseError(error).message),
                }) as TreeElement,
            ];
        }
    }

    /**
     * This function is being called when the resource tree is being built, it is called for every top level of resources.
     * @param resource
     */
    async getResourceItem(resource: CosmosDBAccountModel): Promise<TreeElement> {
        const resourceItem = await callWithTelemetryAndErrorHandling(
            'CosmosDBBranchDataProvider.getResourceItem',
            (context: IActionContext) => {
                const id = nonNullProp(resource, 'id');
                const name = nonNullProp(resource, 'name');
                const type = nonNullProp(resource, 'type');

                context.valuesToMask.push(id);
                context.valuesToMask.push(name);

                if (type.toLocaleLowerCase() === databaseAccountType.toLocaleLowerCase()) {
                    const accountModel = resource;
                    const experience = tryGetExperience(resource);

                    if (experience?.api === API.MongoDB) {
                        // 1. extract the basic info from the element (subscription, resource group, etc., provided by Azure Resources)
                        const clusterInfo: ClusterModel = {
                            ...resource,
                            dbExperience: MongoExperience,
                        } as ClusterModel;

                        const clusterItem = new MongoRUResourceItem(resource.subscription, clusterInfo);
                        return clusterItem;
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

                return null as unknown as TreeElement;
            },
        );

        if (resourceItem) {
            return ext.state.wrapItemInStateHandling(resourceItem, (item: TreeElement) =>
                this.refresh(item),
            ) as TreeElement;
        }

        return null as unknown as TreeElement;
    }

    async getTreeItem(element: TreeElement): Promise<vscode.TreeItem> {
        return element.getTreeItem();
    }

    refresh(element?: TreeElement): void {
        this.onDidChangeTreeDataEmitter.fire(element);
    }
}
