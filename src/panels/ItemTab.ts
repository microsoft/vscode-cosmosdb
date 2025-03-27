/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ItemDefinition, type JSONValue } from '@azure/cosmos';
import { callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { getCosmosDBKeyCredential } from '../cosmosdb/getCosmosClient';
import { type NoSqlQueryConnection } from '../cosmosdb/NoSqlCodeLensProvider';
import { ItemSession } from '../cosmosdb/session/ItemSession';
import { type CosmosDBItemIdentifier } from '../cosmosdb/types/queryResult';
import { promptAfterActionEventually } from '../utils/survey';
import { ExperienceKind, UsageImpact } from '../utils/surveyTypes';
import { BaseTab, type CommandPayload } from './BaseTab';

type ItemTabMode = 'add' | 'edit' | 'view';

export class ItemTab extends BaseTab {
    public static readonly viewType = 'cosmosDBItem';
    public static readonly openTabs: Set<ItemTab> = new Set<ItemTab>();

    private readonly session: ItemSession;

    private connection: NoSqlQueryConnection;
    private itemId: CosmosDBItemIdentifier | undefined;
    private _mode: ItemTabMode = 'view';
    private isDirty = false;

    protected constructor(
        panel: vscode.WebviewPanel,
        connection: NoSqlQueryConnection,
        mode: ItemTabMode,
        itemId?: CosmosDBItemIdentifier,
    ) {
        super(panel, ItemTab.viewType, { hasConnection: connection ? 'true' : 'false' });

        ItemTab.openTabs.add(this);

        this.connection = connection;
        this.itemId = itemId ?? undefined;
        this._mode = mode;

        if (connection.credentials) {
            const masterKey = getCosmosDBKeyCredential(connection.credentials)?.key;
            if (masterKey) {
                this.telemetryContext.addMaskedValue(masterKey);
            }
        }

        this.telemetryContext.addMaskedValue(connection.databaseId);
        this.telemetryContext.addMaskedValue(connection.containerId);

        this.session = new ItemSession(connection, this.channel);
    }

    public static render(
        connection: NoSqlQueryConnection,
        mode: ItemTabMode,
        itemId?: CosmosDBItemIdentifier,
        viewColumn?: vscode.ViewColumn,
    ): ItemTab {
        const column = viewColumn ?? vscode.ViewColumn.Active;
        if (itemId) {
            const openTab = [...ItemTab.openTabs].find((openTab) => {
                if (!openTab.itemId) {
                    return false;
                }

                if (itemId._rid && openTab.itemId._rid && openTab.itemId._rid === itemId._rid) {
                    return true;
                }

                if (itemId.partitionKey !== undefined && openTab.itemId.partitionKey !== undefined) {
                    const openTabPK = Array.isArray(openTab.itemId.partitionKey)
                        ? openTab.itemId.partitionKey.join(',')
                        : openTab.itemId.partitionKey?.toString();
                    const pk = Array.isArray(itemId.partitionKey)
                        ? itemId.partitionKey.join(',')
                        : itemId.partitionKey?.toString();

                    return itemId.id === openTab.itemId.id && openTabPK === pk;
                }

                return itemId.id === openTab.itemId.id;
            });

            if (openTab) {
                openTab.mode = mode;
                openTab.panel.reveal(column);
                return openTab;
            }
        }

        const title = `${itemId?.id ? itemId.id : l10n.t('New Item')}.json`;
        const panel = vscode.window.createWebviewPanel(ItemTab.viewType, title, column, {
            enableScripts: true,
            retainContextWhenHidden: true,
        });

        return new ItemTab(panel, connection, mode, itemId);
    }

    public dispose(): void {
        ItemTab.openTabs.delete(this);

        this.session.dispose();

        super.dispose();
    }

    public get mode(): ItemTabMode {
        return this._mode;
    }
    public set mode(value: ItemTabMode) {
        if (value === 'view' && this._mode === 'edit' && this.isDirty) {
            // do nothing, just keep the edit mode
            return;
        }

        this._mode = value;

        void this.channel.postMessage({
            type: 'event',
            name: 'modeChanged',
            params: [this._mode],
        });
    }

    protected initController() {
        super.initController();

        this.channel.on<void>('ready', async () => {
            await this.channel.postMessage({
                type: 'event',
                name: 'initState',
                params: [this.mode, this.connection.databaseId, this.connection.containerId, this.itemId],
            });
            if (this.itemId) {
                await this.session.read(this.itemId);
            } else if (this.mode === 'add') {
                await this.session.setNewItemTemplate();
            } else {
                // TODO: Handle error
            }
        });
    }

    protected getCommand(payload: CommandPayload): Promise<void> {
        const commandName = payload.commandName;
        switch (commandName) {
            case 'refreshItem':
                return this.refreshItem();
            case 'saveItem':
                return this.saveItem(payload.params[0] as string);
            case 'setMode':
                this.mode = payload.params[0] as ItemTabMode;
                return Promise.resolve();
            case 'setDirty':
                this.isDirty = payload.params[0] as boolean;
                return Promise.resolve();
        }

        return super.getCommand(payload);
    }

    private async refreshItem(): Promise<void> {
        await callWithTelemetryAndErrorHandling('cosmosDB.nosql.item.refreshItem', async () => {
            if (this.itemId) {
                await this.session.read(this.itemId);
            } else {
                await this.session.setNewItemTemplate();
            }
        });
    }

    private async saveItem(itemText: string): Promise<void> {
        const callbackId = 'cosmosDB.nosql.item.saveItem';
        await callWithTelemetryAndErrorHandling(callbackId, async (context) => {
            const itemContent: JSONValue = JSON.parse(itemText) as JSONValue;

            if (!this.isCosmosDBItemDefinition(itemContent)) {
                throw new Error(l10n.t('Item is not a valid Cosmos DB item definition'));
            }

            const result = this.itemId
                ? await this.session.update(itemContent, this.itemId)
                : await this.session.create(itemContent);

            if (!result) {
                // TODO: should we show an error message notification?
                context.errorHandling.suppressDisplay = true;
                throw new Error(l10n.t('Failed to create item'));
            }

            this.itemId = result;

            this.panel.title = `${this.itemId.id}.json`;
        });
        void promptAfterActionEventually(ExperienceKind.NoSQL, UsageImpact.High, callbackId);
    }

    private isCosmosDBItemDefinition(itemContent: unknown): itemContent is ItemDefinition {
        if (itemContent && typeof itemContent === 'object' && !Array.isArray(itemContent)) {
            if ('id' in itemContent) {
                return typeof itemContent.id === 'string';
            } else {
                return true;
            }
        }

        return false;
    }
}
