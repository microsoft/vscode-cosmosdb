/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Container, CosmosClient, FeedOptions, QueryIterator, Resource, StoredProcedureDefinition } from '@azure/cosmos';
import * as vscode from "vscode";
import { AzExtTreeItem, ICreateChildImplContext, TreeItemIconPath } from 'vscode-azureextensionui';
import { defaultStoredProcedure } from '../../constants';
import { ext } from '../../extensionVariables';
import { GraphCollectionTreeItem } from '../../graph/tree/GraphCollectionTreeItem';
import { localize } from '../../utils/localize';
import { nonNullProp } from '../../utils/nonNull';
import { DocDBCollectionTreeItem } from './DocDBCollectionTreeItem';
import { DocDBStoredProcedureTreeItem } from './DocDBStoredProcedureTreeItem';
import { DocDBTreeItemBase } from './DocDBTreeItemBase';

/**
 * This class represents the DocumentDB "Stored Procedures" node in the tree
 */
export class DocDBStoredProceduresTreeItem extends DocDBTreeItemBase<StoredProcedureDefinition> {

    public static contextValue: string = "cosmosDBStoredProceduresGroup";
    public readonly contextValue: string = DocDBStoredProceduresTreeItem.contextValue;
    public readonly childTypeLabel: string = "Stored Procedure";
    public readonly parent: DocDBCollectionTreeItem | GraphCollectionTreeItem;

    constructor(parent: DocDBCollectionTreeItem | GraphCollectionTreeItem) {
        super(parent);
    }

    public initChild(resource: StoredProcedureDefinition & Resource): DocDBStoredProcedureTreeItem {
        return new DocDBStoredProcedureTreeItem(this, resource);
    }

    public get iconPath(): TreeItemIconPath {
        return new vscode.ThemeIcon('server-process');
    }

    public async createChildImpl(context: ICreateChildImplContext): Promise<DocDBStoredProcedureTreeItem> {
        const client = this.root.getCosmosClient();
        const currStoredProcedureList: AzExtTreeItem[] = await this.getCachedChildren(context);
        const currStoredProcedureNames: string[] = [];
        for (const sp of currStoredProcedureList) {
            currStoredProcedureNames.push(nonNullProp(sp, "id"));
        }
        const spID = (await ext.ui.showInputBox({
            prompt: "Enter a unique stored procedure ID",
            validateInput: (name: string) => this.validateStoredProcedureName(name, currStoredProcedureNames)
        })).trim();
        const body: StoredProcedureDefinition = { id: spID, body: defaultStoredProcedure };
        context.showCreatingTreeItem(spID);
        const sproc = await this.getContainerClient(client).scripts.storedProcedures.create(body);

        return this.initChild(nonNullProp(sproc, 'resource'));
    }

    public get id(): string {
        return "$StoredProcedures";
    }

    public get label(): string {
        return "Stored Procedures";
    }

    public get link(): string {
        return this.parent.link;
    }

    public getIterator(client: CosmosClient, feedOptions: FeedOptions): QueryIterator<StoredProcedureDefinition & Resource> {
        return this.getContainerClient(client).scripts.storedProcedures.readAll(feedOptions);
    }

    public getContainerClient(client: CosmosClient): Container {
        return this.parent.getContainerClient(client);
    }

    private validateStoredProcedureName(name: string, currStoredProcedureNames: string[]): string | undefined {
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
            return localize('nameExists', 'Stored Procedure "{0}" already exists.', name);
        }

        return undefined;
    }
}
