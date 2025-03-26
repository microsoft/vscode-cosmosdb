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
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { API } from '../../../AzureDBExperiences';
import { ext } from '../../../extensionVariables';
import { type CosmosDBAccountModel } from '../../cosmosdb/models/CosmosDBAccountModel';
import { type TreeElement } from '../../TreeElement';
import { isTreeElementWithContextValue } from '../../TreeElementWithContextValue';
import { isTreeElementWithExperience } from '../../TreeElementWithExperience';
import { CosmosDBWorkspaceItem } from './CosmosDBWorkspaceItem';

export class CosmosDBWorkspaceBranchDataProvider
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
                'CosmosDBWorkspaceBranchDataProvider.getChildren',
                async (context: IActionContext) => {
                    context.telemetry.properties.view = 'workspace';
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
                    contextValue: 'cosmosDB.workspace.item.error',
                    label: l10n.t('Error: {0}', parseError(error).message),
                }) as TreeElement,
            ];
        }
    }

    /**
     * This function is being called when the resource tree is being built, it is called for every top level of resources.
     */
    async getResourceItem(): Promise<TreeElement> {
        const resourceItem = await callWithTelemetryAndErrorHandling(
            'CosmosDBWorkspaceBranchDataProvider.getResourceItem',
            () => new CosmosDBWorkspaceItem(),
        );

        if (resourceItem) {
            // Workspace picker relies on this value
            ext.cosmosDBWorkspaceBranchDataResource = resourceItem;

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
