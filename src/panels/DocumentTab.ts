/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { getCosmosDBKeyCredential } from '../cosmosdb/CosmosDBCredential';
import { type NoSqlQueryConnection } from '../cosmosdb/NoSqlQueryConnection';
import { type CosmosDBRecordIdentifier } from '../cosmosdb/types/queryResult';
import { BaseTab } from './BaseTab';
import { documentAppRouter, documentCallerFactory, type DocumentRouterContext } from './trpc/appRouter';
import { setupTrpc } from './trpc/setupTrpc';

type DocumentTabMode = 'add' | 'edit' | 'view';

export class DocumentTab extends BaseTab {
    public static readonly viewType = 'cosmosDbDocument';
    public static readonly openTabs: Set<DocumentTab> = new Set<DocumentTab>();

    private connection: NoSqlQueryConnection;
    private documentId: CosmosDBRecordIdentifier | undefined;

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

        if (connection.credentials) {
            const masterKey = getCosmosDBKeyCredential(connection.credentials)?.key;
            if (masterKey) {
                this.telemetryContext.addMaskedValue(masterKey);
            }
        }

        this.telemetryContext.addMaskedValue(connection.databaseId);
        this.telemetryContext.addMaskedValue(connection.containerId);

        // Set up tRPC with DocumentRouterContext
        const routerContext: DocumentRouterContext = {
            webviewName: DocumentTab.viewType,
            connection: this.connection,
            telemetryContext: this.telemetryContext,
            panel: this.panel,
            state: {
                mode: mode,
                documentId: this.documentId,
                isDirty: false,
            },
        };

        const { disposable } = setupTrpc(this.panel, routerContext, documentAppRouter, documentCallerFactory);
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
                // Just reveal the existing tab; mode changes are only done via the webview
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

        super.dispose();
    }
}
