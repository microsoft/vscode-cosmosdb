/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    type AzExtTreeItem,
    type IActionContext,
    type ICreateChildImplContext,
    type TreeItemIconPath,
} from '@microsoft/vscode-azext-utils';
import { type AppResource, type ResolvedAppResourceBase } from '@microsoft/vscode-azext-utils/hostapi';
import { type DocDBAccountTreeItemBase } from '../docdb/tree/DocDBAccountTreeItemBase';
import { type MongoAccountTreeItem } from '../mongo/tree/MongoAccountTreeItem';
import { PostgresServerTreeItem } from '../postgres/tree/PostgresServerTreeItem';

export class ResolvedDatabaseAccountResource implements ResolvedAppResourceBase {
    public id: string;
    public contextValuesToAdd: string[] = [];
    public description: string | undefined;

    // private _databaseTreeItem: AzExtParentTreeItem;
    iconPath: TreeItemIconPath | undefined;
    label: string;

    readonly childTypeLabel: string;

    loadMoreChildrenImpl?(clearCache: boolean, context: IActionContext): Promise<AzExtTreeItem[]>;
    createChildImpl?(context: ICreateChildImplContext): Promise<AzExtTreeItem>;
    hasMoreChildrenImpl?(): boolean;
    compareChildrenImpl?(item1: AzExtTreeItem, item2: AzExtTreeItem): number;

    pickTreeItemImpl?(
        expectedContextValues: (string | RegExp)[],
        context: IActionContext,
    ): AzExtTreeItem | undefined | Promise<AzExtTreeItem | undefined>;
    deleteTreeItemImpl?(context: IActionContext): Promise<void>;
    refreshImpl?(context: IActionContext): Promise<void>;
    isAncestorOfImpl?(contextValue: string): boolean;

    connectionString: string;
    maskedValuestoAdd: string[] = [];

    public constructor(
        ti: DocDBAccountTreeItemBase | MongoAccountTreeItem | PostgresServerTreeItem,
        resource: AppResource,
    ) {
        this.id = ti.id ?? resource.id;
        // PostgresServerTreeItem require on a property on the server so wait to do this
        this.description = ti instanceof PostgresServerTreeItem ? undefined : ti.description;
        this.iconPath = ti.iconPath;
        this.label = ti.label;
        this.childTypeLabel = ti.childTypeLabel;

        this.loadMoreChildrenImpl = ti.loadMoreChildrenImpl;
        this.createChildImpl = ti.createChildImpl;
        this.hasMoreChildrenImpl = ti.hasMoreChildrenImpl;
        this.compareChildrenImpl = ti.compareChildrenImpl;

        this.pickTreeItemImpl = ti.pickTreeItemImpl;
        this.deleteTreeItemImpl = ti.deleteTreeItemImpl;
        this.refreshImpl = ti.refreshImpl;
        this.isAncestorOfImpl = ti.isAncestorOfImpl;

        this.contextValuesToAdd.push(ti.contextValue);
        this.maskedValuestoAdd.push(...ti.valuesToMask);
    }
}
