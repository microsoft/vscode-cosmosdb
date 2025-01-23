/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    azureResourceExperience,
    type ContextValueFilter,
    type ITreeItemPickerContext,
} from '@microsoft/vscode-azext-utils';
import { type AzExtResourceType } from '@microsoft/vscode-azureresources-api';
import { type TreeItem, type TreeItemLabel } from 'vscode';
import { ext } from '../../extensionVariables';
import { type CosmosDBTreeElement } from '../../tree/CosmosDBTreeElement';
import { WorkspaceResourceType } from '../../tree/workspace/SharedWorkspaceResourceProvider';

export interface PickAppResourceOptions {
    type?: AzExtResourceType | AzExtResourceType[];
    expectedChildContextValue?: string | RegExp | (string | RegExp)[];
}

export interface PickWorkspaceResourceOptions {
    type: WorkspaceResourceType | WorkspaceResourceType[];
    expectedChildContextValue?: string | RegExp | (string | RegExp)[];
}

export async function pickAppResource<T extends CosmosDBTreeElement>(
    context: ITreeItemPickerContext,
    options?: PickAppResourceOptions,
): Promise<T> {
    return await azureResourceExperience<T>(
        context,
        ext.rgApiV2.resources.azureResourceTreeDataProvider,
        options?.type ? (Array.isArray(options.type) ? options.type : [options.type]) : undefined,
        options?.expectedChildContextValue ? { include: options.expectedChildContextValue } : undefined,
    );
}

const isPick = (node: TreeItem, contextValueFilter?: ContextValueFilter): boolean => {
    if (!contextValueFilter) {
        return true;
    }

    const includeOption = contextValueFilter.include;
    const excludeOption = contextValueFilter.exclude;

    const includeArray: (string | RegExp)[] = Array.isArray(includeOption) ? includeOption : [includeOption];
    const excludeArray: (string | RegExp)[] = excludeOption
        ? Array.isArray(excludeOption)
            ? excludeOption
            : [excludeOption]
        : [];

    const nodeContextValues: string[] = node.contextValue?.split(';') ?? [];
    const matchesSingleFilter = (matcher: string | RegExp, nodeContextValues: string[]) => {
        return nodeContextValues.some((c) => {
            if (matcher instanceof RegExp) {
                return matcher.test(c);
            }

            // Context value matcher is a string, do full equality (same as old behavior)
            return c === matcher;
        });
    };

    return (
        includeArray.some((i) => matchesSingleFilter(i, nodeContextValues)) &&
        !excludeArray.some((e) => matchesSingleFilter(e, nodeContextValues))
    );
};

export async function pickWorkspaceResource<T extends CosmosDBTreeElement>(
    context: ITreeItemPickerContext,
    options?: PickWorkspaceResourceOptions,
): Promise<T> {
    options ??= {
        type: [WorkspaceResourceType.AttachedAccounts, WorkspaceResourceType.MongoClusters],
        expectedChildContextValue: ['treeItem.account', 'treeItem.mongoCluster'],
    };

    const types = Array.isArray(options.type) ? options.type : [options.type];
    const contextValueFilter = options?.expectedChildContextValue
        ? { include: options.expectedChildContextValue }
        : undefined;

    const firstWorkspaceResources = types
        .map((type) => {
            if (type === WorkspaceResourceType.AttachedAccounts) {
                return ext.cosmosDBWorkspaceBranchDataResource;
            } else if (type === WorkspaceResourceType.MongoClusters) {
                return ext.mongoClusterWorkspaceBranchDataResource;
            }

            return undefined;
        })
        .filter((resource) => resource !== undefined);

    const childrenPromise = await Promise.allSettled(firstWorkspaceResources.map((item) => item?.getChildren()));
    const items = childrenPromise.map((promise) => (promise.status === 'fulfilled' ? promise.value : [])).flat();
    const quickPickItemsPromise = await Promise.allSettled(
        items.map(async (item) => [await item.getTreeItem(), item] as const),
    );
    const quickPickItems = quickPickItemsPromise
        .map((promise) => (promise.status === 'fulfilled' ? promise.value : undefined))
        .filter((item) => item !== undefined)
        .filter(([treeItem]) => isPick(treeItem, contextValueFilter))
        .map(([treeItem, item]) => {
            return {
                label: ((treeItem.label as TreeItemLabel)?.label || treeItem.label) as string,
                description: treeItem.description as string,
                data: item,
            };
        });

    const pickedItem = await context.ui.showQuickPick(quickPickItems, {});
    const node = pickedItem.data;

    return node as T;
}
