/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Container, CosmosClient, FeedOptions, QueryIterator, Resource, StoredProcedureDefinition } from '@azure/cosmos';
import * as vscode from "vscode";
import { AzExtTreeItem, ICreateChildImplContext } from 'vscode-azureextensionui';
import { defaultStoredProcedure, getThemeAgnosticIconPath } from '../../constants';
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

    public get iconPath(): string | vscode.Uri | { light: string | vscode.Uri; dark: string | vscode.Uri } {
        return getThemeAgnosticIconPath('stored procedures.svg');
    }

    public async createChildImpl(context: ICreateChildImplContext): Promise<DocDBStoredProcedureTreeItem> {
        const client = this.root.getCosmosClient();
        const getChildrenTask: Promise<AzExtTreeItem[]> = this.getCachedChildren(context);
        const spID = (await ext.ui.showInputBox({
            prompt: "Enter a unique stored procedure ID",
            validateInput: (name: string) => this.validateStoredProcedureName(name, getChildrenTask)
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

    private async validateStoredProcedureName(name: string, getChildrenTask: Promise<AzExtTreeItem[]>): Promise<string | null | undefined> {
        const currStoredProcedureList = await getChildrenTask;
        const currStoredProcedureNames: string[] = [];
        for (const sp of currStoredProcedureList) {
            if (sp instanceof DocDBStoredProcedureTreeItem) {
                currStoredProcedureNames.push(sp.id);
            }
        }
        if (name) {
            if (name.length < 1 || name.length > 255) {
                return "Name has to be between 1 and 255 chars long";
            }
            if (/[/\\?#&]/.test(name)) {
                return localize("illegalChars", "Name contains illegal chars: /,\\,?,#,&");
            }
            if (name[name.length - 1] === " ") {
                return localize("endsWithSpace", "Name ends with a space.");
            }
            if (currStoredProcedureNames.includes(name)) {
                return localize('NameExists', 'Stored Procedure "{0}" already exists.', name);
            }
        } else {
            return localize("noEmptyValue", "Name cannot be empty");
        }
        return null;
    }
}
