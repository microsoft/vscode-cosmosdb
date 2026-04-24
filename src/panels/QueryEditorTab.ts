/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { getThemedIconPath } from '../constants';
import { getCosmosDBKeyCredential } from '../cosmosdb/CosmosDBCredential';
import { type NoSqlQueryConnection } from '../cosmosdb/NoSqlQueryConnection';
import { type QuerySession } from '../cosmosdb/session/QuerySession';
import { type SerializedQueryResult } from '../cosmosdb/types/queryResult';
import { SchemaFileStorage } from '../services/SchemaFileStorage';
import { type JSONSchema } from '../utils/json/JSONSchema';
import { getIsSurveyDisabledGlobally } from '../utils/survey';
import { TypedEventSink } from '../utils/TypedEventSink';
import { BaseTab } from './BaseTab';
import {
    queryEditorAppRouter,
    queryEditorCallerFactory,
    type QueryEditorMutableState,
    type QueryEditorRouterContext,
} from './trpc/appRouter';
import { type QueryEditorEvent } from './trpc/routers/queryEditorEventsRouter';
import { setupTrpc } from './trpc/setupTrpc';

export class QueryEditorTab extends BaseTab {
    public static readonly title = 'Query Editor';
    public static readonly viewType = 'cosmosDbQuery';
    public static readonly openTabs: Set<QueryEditorTab> = new Set<QueryEditorTab>();

    public readonly sessions = new Map<string, QuerySession>();
    public readonly eventSink: TypedEventSink<QueryEditorEvent>;

    private readonly state: QueryEditorMutableState;

    protected constructor(panel: vscode.WebviewPanel, connection?: NoSqlQueryConnection, query?: string) {
        super(panel, QueryEditorTab.viewType, { hasConnection: connection ? 'true' : 'false' });

        QueryEditorTab.openTabs.add(this);

        this.state = {
            connection,
            query,
            isLastQueryAIGenerated: false,
            lastAIGeneratedQuery: undefined,
            lastGenerationFailed: false,
            generateQueryCancellation: undefined,
            pendingConfirmResolve: undefined,
        };

        this.panel.iconPath = getThemedIconPath('editor.svg') as { light: vscode.Uri; dark: vscode.Uri };

        if (connection) {
            if (connection.credentials) {
                const masterKey = getCosmosDBKeyCredential(connection.credentials)?.key;
                if (masterKey) {
                    this.telemetryContext.addMaskedValue(masterKey);
                }
            }

            this.telemetryContext.addMaskedValue(connection.databaseId);
            this.telemetryContext.addMaskedValue(connection.containerId);
        }

        // Create TypedEventSink for tRPC subscription
        this.eventSink = new TypedEventSink<QueryEditorEvent>();

        const { disposable } = setupTrpc(
            this.panel,
            this.buildRouterContext(),
            queryEditorAppRouter,
            queryEditorCallerFactory,
        );
        this.disposables.push(disposable);

        // Listen for schema setting changes
        this.disposables.push(
            vscode.workspace.onDidChangeConfiguration((e) => {
                if (e.affectsConfiguration('cosmosDB.queryEditor.generateSchemaBasedOnQueries')) {
                    this.syncSchemaBasedOnQueriesSetting();
                }
            }),
        );

        // Send schema to webview on init
        void this.sendSchemaToWebview();
    }

    public static render(
        connection?: NoSqlQueryConnection,
        viewColumn = vscode.ViewColumn.Active,
        revealTabIfExist = false,
        query?: string,
    ): QueryEditorTab {
        if (revealTabIfExist && connection) {
            const openTab = [...QueryEditorTab.openTabs].find(
                (openTab) =>
                    openTab.state.connection?.endpoint === connection.endpoint &&
                    openTab.state.connection?.databaseId === connection.databaseId &&
                    openTab.state.connection?.containerId === connection.containerId,
            );
            if (openTab) {
                openTab.panel.reveal(viewColumn);
                return openTab;
            }
        }

        const panel = vscode.window.createWebviewPanel(QueryEditorTab.viewType, QueryEditorTab.title, viewColumn, {
            enableScripts: true,
            retainContextWhenHidden: true,
        });

        return new QueryEditorTab(panel, connection, query);
    }

    public dispose(): void {
        QueryEditorTab.openTabs.delete(this);

        this.sessions.forEach((session) => session.dispose());
        this.sessions.clear();

        this.eventSink.close();

        super.dispose();
    }

    private syncSchemaBasedOnQueriesSetting(): void {
        const config = vscode.workspace.getConfiguration('cosmosDB.queryEditor');
        const isEnabled = config.get<boolean>('generateSchemaBasedOnQueries', false);
        this.eventSink.emit({ type: 'schemaSettingChanged', isSchemaBasedOnQueries: isEnabled });
    }

    private async sendSchemaToWebview(): Promise<void> {
        if (!this.state.connection) {
            this.eventSink.emit({ type: 'schemaUpdated', containerSchema: null });
            return;
        }

        const schemaId = this.getSchemaStorageId(this.state.connection);
        const schemaStorage = SchemaFileStorage.getInstance();
        const schemaJson = await schemaStorage.readSchema(schemaId);

        const schema: JSONSchema | null = schemaJson ? (JSON.parse(schemaJson) as JSONSchema) : null;

        this.eventSink.emit({ type: 'schemaUpdated', containerSchema: schema as Record<string, unknown> | null });
    }

    private getSchemaStorageId(connection: NoSqlQueryConnection): string {
        const raw = `${connection.endpoint}/${connection.databaseId}/${connection.containerId}`;
        return crypto.createHash('sha256').update(raw).digest('hex');
    }

    private buildRouterContext(): QueryEditorRouterContext {
        return {
            webviewName: QueryEditorTab.viewType,
            sessions: this.sessions,
            telemetryContext: this.telemetryContext,
            panel: this.panel,
            eventSink: this.eventSink,
            state: this.state,
        };
    }

    public getCurrentQueryResults = (): SerializedQueryResult | undefined => {
        const activeSession = this.sessions.values().next().value;
        const result = activeSession?.sessionResult;
        return result?.getSerializedResult(1);
    };

    public getConnection = (): NoSqlQueryConnection | undefined => {
        return this.state.connection;
    };

    public getCurrentQuery = (): string | undefined => {
        return this.state.query;
    };

    public isActive(): boolean {
        return this.panel.active;
    }

    public isVisible(): boolean {
        return this.panel.visible;
    }

    /**
     * Broadcasts AI features availability change to all open QueryEditorTabs
     */
    public static async notifyAIFeaturesChanged(isAIFeaturesEnabled: boolean): Promise<void> {
        for (const tab of QueryEditorTab.openTabs) {
            tab.eventSink.emit({ type: 'aiFeaturesEnabledChanged', isEnabled: isAIFeaturesEnabled });
        }
    }

    public async updateQuery(query: string): Promise<void> {
        this.state.query = query;
        this.state.isLastQueryAIGenerated = true;
        this.state.lastAIGeneratedQuery = query;
        this.eventSink.emit({ type: 'queryTextPushed', query });
    }

    public async refreshSurveyFeedbackVisibility(): Promise<void> {
        this.eventSink.emit({
            type: 'isSurveyCandidateChanged',
            isSurveyCandidate: !getIsSurveyDisabledGlobally(),
        });
    }
}
