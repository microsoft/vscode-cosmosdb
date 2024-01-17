/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Container, CosmosClient, FeedOptions, QueryIterator, Resource, TriggerDefinition, TriggerOperation, TriggerType } from '@azure/cosmos';
import { AzExtTreeItem, ICreateChildImplContext, TreeItemIconPath } from '@microsoft/vscode-azext-utils';
import * as vscode from "vscode";
import { defaultTrigger } from '../../constants';
import { GraphCollectionTreeItem } from '../../graph/tree/GraphCollectionTreeItem';
import { localize } from '../../utils/localize';
import { nonNullProp } from '../../utils/nonNull';
import { DocDBCollectionTreeItem } from './DocDBCollectionTreeItem';
import { DocDBTreeItemBase } from './DocDBTreeItemBase';
import { DocDBTriggerTreeItem } from './DocDBTriggerTreeItem';

/**
 * This class represents the DocumentDB "Triggers" node in the tree
 */
export class DocDBTriggersTreeItem extends DocDBTreeItemBase<TriggerDefinition> {

    public static contextValue: string = "cosmosDBTriggersGroup";
    public readonly contextValue: string = DocDBTriggersTreeItem.contextValue;
    public readonly childTypeLabel: string = "Trigger";
    public readonly parent: DocDBCollectionTreeItem;
    public suppressMaskLabel = true;

    constructor(parent: DocDBCollectionTreeItem | GraphCollectionTreeItem) {
        super(parent);
        this.root = this.parent.root;
    }

    public initChild(resource: TriggerDefinition & Resource): DocDBTriggerTreeItem {
        return new DocDBTriggerTreeItem(this, resource);
    }

    public get iconPath(): TreeItemIconPath {
        // @todo: Find the correct icon
        return new vscode.ThemeIcon('server-process');
    }

    public async createChildImpl(context: ICreateChildImplContext): Promise<DocDBTriggerTreeItem> {
        const client = this.root.getCosmosClient();
        const currTriggerList: AzExtTreeItem[] = await this.getCachedChildren(context);
        const currTriggerNames: string[] = [];
        for (const sp of currTriggerList) {
            currTriggerNames.push(nonNullProp(sp, "id"));
        }

        const triggerID = (await context.ui.showInputBox({
            prompt: "Enter a unique trigger ID",
            stepName: 'createTrigger',
            validateInput: (name: string) => this.validateTriggerName(name, currTriggerNames)
        })).trim();

        const triggerTypeOption = (await context.ui.showQuickPick<vscode.QuickPickItem>([
            { label: "Pre" },
            { label: "Post" }
        ], {})).label as "Pre" | "Post";
        const triggerType = triggerTypeOption === "Pre" ? TriggerType.Pre : TriggerType.Post;

        const triggerOperationOption = (await context.ui.showQuickPick<vscode.QuickPickItem>([
            { label: "All" },
            { label: "Create" },
            { label: "Delete" },
            { label: "Replace" },
            { label: "Update" },
        ], {})).label as "All" | "Create" | "Delete" | "Replace" | "Update";
        const triggerOperation: TriggerOperation = TriggerOperation[triggerOperationOption];

        const body: TriggerDefinition = { id: triggerID, body: defaultTrigger, triggerType: triggerType, triggerOperation: triggerOperation };
        context.showCreatingTreeItem(triggerID);
        const response = await this.getContainerClient(client).scripts.triggers.create(body);

        return this.initChild(nonNullProp(response, 'resource'));
    }

    public get id(): string {
        return "$Triggers";
    }

    public get label(): string {
        return "Triggers";
    }

    public get link(): string {
        return this.parent.link;
    }

    public getIterator(client: CosmosClient, feedOptions: FeedOptions): QueryIterator<TriggerDefinition & Resource> {
        return this.getContainerClient(client).scripts.triggers.readAll(feedOptions);
    }

    public getContainerClient(client: CosmosClient): Container {
        return this.parent.getContainerClient(client);
    }

    private validateTriggerName(name: string, currStoredProcedureNames: string[]): string | undefined {
        if (name.length < 1 || name.length > 255) {
            return localize("nameLength", "Name has to be between 1 and 255 chars long");
        }

        if (/[/\\?#&]/.test(name)) {
            return localize("illegalChars", "Name contains illegal chars: /, \\, ?, #, &");
        }
        if (name[name.length - 1] === " ") {
            return localize("endsWithSpace", "Name cannot end with a space.");
        }
        if (currStoredProcedureNames.includes(name)) {
            return localize('nameExists', 'Trigger "{0}" already exists.', name);
        }

        return undefined;
    }
}
