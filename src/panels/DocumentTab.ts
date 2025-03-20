/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ItemDefinition, type JSONValue } from '@azure/cosmos';
import { callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { getCosmosKeyCredential } from '../docdb/getCosmosClient';
import { type NoSqlQueryConnection } from '../docdb/NoSqlCodeLensProvider';
import { DocumentSession } from '../docdb/session/DocumentSession';
import { type CosmosDbRecordIdentifier } from '../docdb/types/queryResult';
import { promptAfterActionEventually } from '../utils/survey';
import { ExperienceKind, UsageImpact } from '../utils/surveyTypes';
import { BaseTab, type CommandPayload } from './BaseTab';

type DocumentTabMode = 'add' | 'edit' | 'view';

export class DocumentTab extends BaseTab {
    public static readonly viewType = 'cosmosDbDocument';
    public static readonly openTabs: Set<DocumentTab> = new Set<DocumentTab>();

    private readonly session: DocumentSession;

    private connection: NoSqlQueryConnection;
    private documentId: CosmosDbRecordIdentifier | undefined;
    private _mode: DocumentTabMode = 'view';
    private isDirty = false;

    protected constructor(
        panel: vscode.WebviewPanel,
        connection: NoSqlQueryConnection,
        mode: DocumentTabMode,
        documentId?: CosmosDbRecordIdentifier,
    ) {
        super(panel, DocumentTab.viewType, { hasConnection: connection ? 'true' : 'false' });

        DocumentTab.openTabs.add(this);

        this.connection = connection;
        this.documentId = documentId ?? undefined;
        this._mode = mode;

        if (connection.credentials) {
            const masterKey = getCosmosKeyCredential(connection.credentials)?.key;
            if (masterKey) {
                this.telemetryContext.addMaskedValue(masterKey);
            }
        }

        this.telemetryContext.addMaskedValue(connection.databaseId);
        this.telemetryContext.addMaskedValue(connection.containerId);

        this.session = new DocumentSession(connection, this.channel);
    }

    public static render(
        connection: NoSqlQueryConnection,
        mode: DocumentTabMode,
        documentId?: CosmosDbRecordIdentifier,
        viewColumn?: vscode.ViewColumn,
    ): DocumentTab {
        const column = viewColumn ?? vscode.ViewColumn.Active;
        if (documentId) {
            const openTab = [...DocumentTab.openTabs].find((openTab) => {
                if (!openTab.documentId) {
                    return false;
                }

                if (documentId._rid && openTab.documentId._rid && openTab.documentId._rid === documentId._rid) {
                    return true;
                }

                if (documentId.partitionKey !== undefined && openTab.documentId.partitionKey !== undefined) {
                    const openTabPK = Array.isArray(openTab.documentId.partitionKey)
                        ? openTab.documentId.partitionKey.join(',')
                        : openTab.documentId.partitionKey?.toString();
                    const pk = Array.isArray(documentId.partitionKey)
                        ? documentId.partitionKey.join(',')
                        : documentId.partitionKey?.toString();

                    return documentId.id === openTab.documentId.id && openTabPK === pk;
                }

                return documentId.id === openTab.documentId.id;
            });

            if (openTab) {
                openTab.mode = mode;
                openTab.panel.reveal(column);
                return openTab;
            }
        }

        const title = `${documentId?.id ? documentId.id : l10n.t('New Document')}.json`;
        const panel = vscode.window.createWebviewPanel(DocumentTab.viewType, title, column, {
            enableScripts: true,
            retainContextWhenHidden: true,
        });

        return new DocumentTab(panel, connection, mode, documentId);
    }

    public dispose(): void {
        DocumentTab.openTabs.delete(this);

        this.session.dispose();

        super.dispose();
    }

    public get mode(): DocumentTabMode {
        return this._mode;
    }
    public set mode(value: DocumentTabMode) {
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
                params: [this.mode, this.connection.databaseId, this.connection.containerId, this.documentId],
            });
            if (this.documentId) {
                await this.session.read(this.documentId);
            } else if (this.mode === 'add') {
                await this.session.setNewDocumentTemplate();
            } else {
                // TODO: Handle error
            }
        });
    }

    protected getCommand(payload: CommandPayload): Promise<void> {
        const commandName = payload.commandName;
        switch (commandName) {
            case 'refreshDocument':
                return this.refreshDocument();
            case 'saveDocument':
                return this.saveDocument(payload.params[0] as string);
            case 'setMode':
                this.mode = payload.params[0] as DocumentTabMode;
                return Promise.resolve();
            case 'setDirty':
                this.isDirty = payload.params[0] as boolean;
                return Promise.resolve();
        }

        return super.getCommand(payload);
    }

    private async refreshDocument(): Promise<void> {
        await callWithTelemetryAndErrorHandling('cosmosDB.nosql.document.refreshDocument', async () => {
            if (this.documentId) {
                await this.session.read(this.documentId);
            } else {
                await this.session.setNewDocumentTemplate();
            }
        });
    }

    private async saveDocument(documentText: string): Promise<void> {
        const callbackId = 'cosmosDB.nosql.document.saveDocument';
        await callWithTelemetryAndErrorHandling(callbackId, async (context) => {
            const documentContent: JSONValue = JSON.parse(documentText) as JSONValue;

            if (!this.isCosmosDbItemDefinition(documentContent)) {
                throw new Error(l10n.t('Item is not a valid Cosmos DB item definition'));
            }

            const result = this.documentId
                ? await this.session.update(documentContent, this.documentId)
                : await this.session.create(documentContent);

            if (!result) {
                // TODO: should we show an error message notification?
                context.errorHandling.suppressDisplay = true;
                throw new Error(l10n.t('Failed to create document'));
            }

            this.documentId = result;

            this.panel.title = `${this.documentId.id}.json`;
        });
        void promptAfterActionEventually(ExperienceKind.NoSQL, UsageImpact.High, callbackId);
    }

    private isCosmosDbItemDefinition(documentContent: unknown): documentContent is ItemDefinition {
        if (documentContent && typeof documentContent === 'object' && !Array.isArray(documentContent)) {
            if ('id' in documentContent) {
                return typeof documentContent.id === 'string';
            } else {
                return true;
            }
        }

        return false;
    }
}
