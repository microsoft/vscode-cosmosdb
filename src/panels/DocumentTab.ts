/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { getCosmosDBKeyCredential } from '../cosmosdb/CosmosDBCredential';
import { type NoSqlQueryConnection } from '../cosmosdb/NoSqlQueryConnection';
import { createDocumentEventEmitter, DocumentSession } from '../cosmosdb/session/DocumentSession';
import { type CosmosDBRecordIdentifier } from '../cosmosdb/types/queryResult';
import { TypedEventSink } from '../utils/TypedEventSink';
import { type DocumentRouterContext } from '../webviews/api/configuration/appRouter';
import { type DocumentEvent } from '../webviews/api/configuration/routers/documentEventsRouter';
import { setupTrpc } from '../webviews/api/extension-server/setupTrpc';
import { BaseTab } from './BaseTab';

type DocumentTabMode = 'add' | 'edit' | 'view';

export class DocumentTab extends BaseTab {
    public static readonly viewType = 'cosmosDbDocument';
    public static readonly openTabs: Set<DocumentTab> = new Set<DocumentTab>();

    private readonly session: DocumentSession;
    public readonly eventSink: TypedEventSink<DocumentEvent>;

    private connection: NoSqlQueryConnection;
    private documentId: CosmosDBRecordIdentifier | undefined;
    private _mode: DocumentTabMode = 'view';
    private isDirty = false;

    protected constructor(
        panel: vscode.WebviewPanel,
        connection: NoSqlQueryConnection,
        mode: DocumentTabMode,
        documentId?: CosmosDBRecordIdentifier,
    ) {
        super(panel, DocumentTab.viewType, { hasConnection: connection ? 'true' : 'false' });

        DocumentTab.openTabs.add(this);

        this.connection = connection;
        this.documentId = documentId ?? undefined;
        this._mode = mode;

        if (connection.credentials) {
            const masterKey = getCosmosDBKeyCredential(connection.credentials)?.key;
            if (masterKey) {
                this.telemetryContext.addMaskedValue(masterKey);
            }
        }

        this.telemetryContext.addMaskedValue(connection.databaseId);
        this.telemetryContext.addMaskedValue(connection.containerId);

        // Create TypedEventSink and DocumentSession with event emitter
        this.eventSink = new TypedEventSink<DocumentEvent>();
        const eventEmitter = createDocumentEventEmitter(this.eventSink);
        this.session = new DocumentSession(connection, eventEmitter);

        // Set up tRPC with DocumentRouterContext
        const routerContext: DocumentRouterContext = {
            dbExperience: 'NoSQL' as DocumentRouterContext['dbExperience'],
            webviewName: DocumentTab.viewType,
            connection: this.connection,
            documentSession: this.session,
            telemetryContext: this.telemetryContext,
            panel: this.panel,
            eventSink: this.eventSink,
            mode: this._mode,
            documentId: this.documentId,
            isDirty: this.isDirty,
        };

        const { disposable } = setupTrpc(this.panel, routerContext);
        this.disposables.push(disposable);
    }

    public static render(
        connection: NoSqlQueryConnection,
        mode: DocumentTabMode,
        documentId?: CosmosDBRecordIdentifier,
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

        const title = `${documentId?.id ? documentId.id : l10n.t('New Item')}.json`;
        const panel = vscode.window.createWebviewPanel(DocumentTab.viewType, title, column, {
            enableScripts: true,
            retainContextWhenHidden: true,
        });

        return new DocumentTab(panel, connection, mode, documentId);
    }

    public dispose(): void {
        DocumentTab.openTabs.delete(this);

        this.eventSink.close();
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

        this.eventSink.emit({ type: 'modeChanged', mode: this._mode });
    }
}
