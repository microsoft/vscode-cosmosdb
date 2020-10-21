/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CosmosClient, FeedOptions, QueryIterator, Resource, StoredProcedureDefinition } from '@azure/cosmos';
import * as vscode from "vscode";
import { ICreateChildImplContext } from 'vscode-azureextensionui';
import { defaultStoredProcedure, getThemeAgnosticIconPath } from '../../constants';
import { ext } from '../../extensionVariables';
import { GraphCollectionTreeItem } from '../../graph/tree/GraphCollectionTreeItem';
import { nonNullProp } from '../../utils/nonNull';
import { DocDBCollectionTreeItem } from './DocDBCollectionTreeItem';
import { DocDBStoredProcedureTreeItem } from './DocDBStoredProcedureTreeItem';
import { DocDBTreeItemBase } from './DocDBTreeItemBase';

/**
 * This class represents the DocumentDB "Stored Procedures" node in the tree
 */
export class DocDBStoredProceduresTreeItem extends DocDBTreeItemBase<StoredProcedureDefinition> {

    public get iconPath(): string | vscode.Uri | { light: string | vscode.Uri; dark: string | vscode.Uri } {
        return getThemeAgnosticIconPath('stored procedures.svg');
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
    public static contextValue: string = "cosmosDBStoredProceduresGroup";
    public readonly contextValue: string = DocDBStoredProceduresTreeItem.contextValue;
    public readonly childTypeLabel: string = "Stored Procedure";
    public readonly parent: DocDBCollectionTreeItem | GraphCollectionTreeItem;
    private readonly _partitionKeyValue: string | undefined | Object;

    constructor(parent: DocDBCollectionTreeItem | GraphCollectionTreeItem) {
        super(parent);
    }

    public initChild(resource: StoredProcedureDefinition & Resource): DocDBStoredProcedureTreeItem {
        return new DocDBStoredProcedureTreeItem(this, resource);
    }

    public async createChildImpl(context: ICreateChildImplContext): Promise<DocDBStoredProcedureTreeItem> {
        const client = this.root.getDocumentClient();
        const spID = (await ext.ui.showInputBox({
            prompt: "Enter a unique stored procedure ID",
            validateInput: this.validateName
        })).trim();
        const body: StoredProcedureDefinition = { id: spID, body: defaultStoredProcedure };
        context.showCreatingTreeItem(spID);
        const sproc = await client.database(this.parent.parent.id).container(this.parent.id).scripts.storedProcedures.create(body);

        return this.initChild(nonNullProp(sproc, 'resource'));
    }

    public async getIterator(client: CosmosClient, feedOptions: FeedOptions): Promise<QueryIterator<StoredProcedureDefinition & Resource>> {
        return client.database(this.parent.parent.id).container(this.parent.id).scripts.storedProcedures.readAll(feedOptions);
    }

    private validateName(name: string): string | null | undefined {
        if (name) {
            if (name.indexOf("/") !== -1 || name.indexOf("\\") !== -1 || name.indexOf("?") !== -1 || name.indexOf("#") !== -1) {
                return "Id contains illegal chars: /,\\,?,#";
            }
            if (name[name.length - 1] === " ") {
                return "Id ends with a space.";
            }
        }
        return null;
    }
}
