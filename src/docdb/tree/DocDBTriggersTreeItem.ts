/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    TriggerOperation,
    TriggerType,
    type Container,
    type CosmosClient,
    type FeedOptions,
    type QueryIterator,
    type Resource,
    type TriggerDefinition,
} from '@azure/cosmos';
import {
    type AzExtTreeItem,
    type IActionContext,
    type ICreateChildImplContext,
    type TreeItemIconPath,
} from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { defaultTrigger } from '../../constants';
import { type GraphCollectionTreeItem } from '../../graph/tree/GraphCollectionTreeItem';
import { localize } from '../../utils/localize';
import { nonNullProp } from '../../utils/nonNull';
import { type DocDBCollectionTreeItem } from './DocDBCollectionTreeItem';
import { DocDBTreeItemBase } from './DocDBTreeItemBase';
import { DocDBTriggerTreeItem } from './DocDBTriggerTreeItem';

/**
 * This class represents the DocumentDB "Triggers" node in the tree
 */
export class DocDBTriggersTreeItem extends DocDBTreeItemBase<TriggerDefinition> {
    public static contextValue: string = 'cosmosDBTriggersGroup';
    public readonly contextValue: string = DocDBTriggersTreeItem.contextValue;
    public readonly childTypeLabel: string = 'Trigger';
    public readonly parent: DocDBCollectionTreeItem | GraphCollectionTreeItem;
    public suppressMaskLabel = true;

    constructor(parent: DocDBCollectionTreeItem | GraphCollectionTreeItem) {
        super(parent);
        this.parent = parent;
        this.root = this.parent.root;
    }

    public initChild(resource: TriggerDefinition & Resource): DocDBTriggerTreeItem {
        return new DocDBTriggerTreeItem(this, resource);
    }

    public get iconPath(): TreeItemIconPath {
        return new vscode.ThemeIcon('zap');
    }

    public async createChildImpl(context: ICreateChildImplContext): Promise<DocDBTriggerTreeItem> {
        const client = this.root.getCosmosClient();
        const currTriggerList: AzExtTreeItem[] = await this.getCachedChildren(context);
        const currTriggerNames: string[] = [];
        for (const sp of currTriggerList) {
            currTriggerNames.push(nonNullProp(sp, 'id'));
        }

        const triggerID = (
            await context.ui.showInputBox({
                prompt: 'Enter a unique trigger ID',
                stepName: 'createTrigger',
                validateInput: (name: string) => this.validateTriggerName(name, currTriggerNames),
            })
        ).trim();

        const triggerType = await getTriggerType(context);
        const triggerOperation = await getTriggerOperation(context);

        const body: TriggerDefinition = {
            id: triggerID,
            body: defaultTrigger,
            triggerType: triggerType,
            triggerOperation: triggerOperation,
        };
        context.showCreatingTreeItem(triggerID);
        const response = await this.getContainerClient(client).scripts.triggers.create(body);

        return this.initChild(nonNullProp(response, 'resource'));
    }

    public get id(): string {
        return '$Triggers';
    }

    public get label(): string {
        return 'Triggers';
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

    private validateTriggerName(name: string, currTriggerNames: string[]): string | undefined {
        if (name.length < 1 || name.length > 255) {
            return localize('nameLength', 'Name has to be between 1 and 255 chars long');
        }

        if (/[/\\?#&]/.test(name)) {
            return localize('illegalChars', 'Name contains illegal chars: /, \\, ?, #, &');
        }
        if (name[name.length - 1] === ' ') {
            return localize('endsWithSpace', 'Name cannot end with a space.');
        }
        if (currTriggerNames.includes(name)) {
            return localize('nameExists', 'Trigger "{0}" already exists.', name);
        }

        return undefined;
    }
}

export async function getTriggerType(context: IActionContext): Promise<TriggerType> {
    const options = Object.keys(TriggerType).map((type) => ({ label: type }));
    const triggerTypeOption = await context.ui.showQuickPick<vscode.QuickPickItem>(options, {
        placeHolder: localize('createDocDBTriggerSelectType', 'Select the trigger type'),
    });
    return triggerTypeOption.label === 'Pre' ? TriggerType.Pre : TriggerType.Post;
}

export async function getTriggerOperation(context: IActionContext): Promise<TriggerOperation> {
    const options = Object.keys(TriggerOperation).map((key) => ({ label: key }));
    const triggerOperationOption = await context.ui.showQuickPick<vscode.QuickPickItem>(options, {
        placeHolder: localize('createDocDBTriggerSelectOperation', 'Select the trigger operation'),
    });
    return TriggerOperation[triggerOperationOption.label as keyof typeof TriggerOperation];
}
