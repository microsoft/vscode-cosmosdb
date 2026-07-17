/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type JSONSchema } from '@cosmosdb/schema-analyzer';
import { TypedEventSink } from '@cosmosdb/webview-rpc';
import { setupTrpc } from '@cosmosdb/webview-rpc/server';
import * as vscode from 'vscode';
import { getThemedIconPath } from '../constants';
import { getCosmosDBKeyCredential } from '../cosmosdb/CosmosDBCredential';
import { type NoSqlQueryConnection } from '../cosmosdb/NoSqlQueryConnection';
import { type QuerySession } from '../cosmosdb/session/QuerySession';
import { type SerializedQueryResult } from '../cosmosdb/types/queryResult';
import { SchemaFileStorage } from '../services/SchemaFileStorage';
import { SchemaService } from '../services/SchemaService';
import { getIsSurveyDisabledGlobally } from '../utils/survey';
import { BaseTab } from './BaseTab';
import {
    queryEditorAppRouter,
    queryEditorCallerFactory,
    type QueryEditorMutableState,
    type QueryEditorRouterContext,
} from './trpc/appRouter';
import { type QueryEditorEvent } from './trpc/routers/queryEditorEventsRouter';

export class QueryEditorTab extends BaseTab {
    public static readonly title = 'Query Editor';
    public static readonly viewType = 'cosmosDbQuery';
    public static readonly openTabs: Set<QueryEditorTab> = new Set<QueryEditorTab>();

    public readonly sessions = new Map<string, QuerySession>();
    public readonly eventSink: TypedEventSink<QueryEditorEvent>;

    private readonly state: QueryEditorMutableState;
    private static readonly DEFAULT_QUERY_VALUE = `SELECT * FROM c`;

    protected constructor(panel: vscode.WebviewPanel, connection?: NoSqlQueryConnection, query?: string) {
        super(panel, QueryEditorTab.viewType, { hasConnection: connection ? 'true' : 'false' });

        QueryEditorTab.openTabs.add(this);

        this.state = {
            connection,
            query: query ?? QueryEditorTab.DEFAULT_QUERY_VALUE,
            isLastQueryAIGenerated: false,
            lastAIGeneratedQuery: undefined,
            lastGenerationFailed: false,
            generateQueryCancellation: undefined,
            pendingConfirmResolve: undefined,
            lastGeneratePrompt: undefined,
            pendingRunResolve: undefined,
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

        // Mirror schema mutations into Monaco autocomplete. Any code path
        // (toolbar action, AI sample tool, query merge, document creation,
        // cascade delete on container/db drop) flows through SchemaService,
        // so subscribing here is enough — individual callers must NOT push
        // schemaUpdated events of their own.
        this.disposables.push(
            SchemaService.getInstance().onSchemaChanged((event) => {
                const c = this.state.connection;
                if (
                    c &&
                    c.endpoint === event.endpoint &&
                    c.databaseId === event.databaseId &&
                    c.containerId === event.containerId
                ) {
                    void this.sendSchemaToWebview();
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

    public async sendSchemaToWebview(): Promise<void> {
        if (!this.state.connection) {
            this.eventSink.emit({ type: 'schemaUpdated', containerSchema: null });
            return;
        }

        const schemaId = SchemaFileStorage.getSchemaIdForConnection(this.state.connection);
        const schemaStorage = SchemaFileStorage.getInstance();
        const schemaJson = await schemaStorage.readSchema(schemaId);

        const schema: JSONSchema | null = schemaJson ? (JSON.parse(schemaJson) as JSONSchema) : null;

        this.eventSink.emit({ type: 'schemaUpdated', containerSchema: schema as Record<string, unknown> | null });
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

    public getSelectedQuery = (): string | undefined => {
        return this.state.selectedQuery;
    };

    public getLastGeneratePrompt = (): string | undefined => {
        return this.state.lastGeneratePrompt;
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
    public static notifyAIFeaturesChanged(isAIFeaturesEnabled: boolean): void {
        for (const tab of QueryEditorTab.openTabs) {
            tab.eventSink.emit({ type: 'aiFeaturesEnabledChanged', isEnabled: isAIFeaturesEnabled });
        }
    }

    /**
     * Forces the survey-candidate flag on all open QueryEditorTabs, which
     * controls whether the thumbs up/down feedback buttons render. Used by the
     * `cosmosDB.e2e.setSurveyCandidate` test command so specs don't depend on
     * the ambient `telemetry.feedback.enabled` setting of the test VS Code.
     */
    public static notifySurveyCandidate(isSurveyCandidate: boolean): void {
        for (const tab of QueryEditorTab.openTabs) {
            tab.eventSink.emit({ type: 'isSurveyCandidateChanged', isSurveyCandidate });
        }
    }

    public updateQuery(query: string): void {
        this.state.query = query;
        this.state.isLastQueryAIGenerated = true;
        this.state.lastAIGeneratedQuery = query;
        this.eventSink.emit({ type: 'queryTextPushed', query });
    }

    /**
     * Asks the webview to run `query` in the Query Editor (so results appear in the grid) and
     * resolves once the webview reports completion via `reportActiveQueryExecuted`. Used by the
     * `cosmosdb_executeCurrentQuery` tool, which then reads PII-free result metadata from the session.
     * Resolves after `timeoutMs` as a safety net so the tool never hangs.
     */
    public runActiveQueryInEditor(query: string, timeoutMs = 120_000): Promise<void> {
        // Abandon any prior pending run so a stale resolver can't fire against this one.
        this.state.pendingRunResolve?.();
        return new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
                this.state.pendingRunResolve = undefined;
                resolve();
            }, timeoutMs);
            this.state.pendingRunResolve = () => {
                clearTimeout(timer);
                this.state.pendingRunResolve = undefined;
                resolve();
            };
            this.eventSink.emit({ type: 'runActiveQueryRequested', query });
        });
    }

    public refreshSurveyFeedbackVisibility(): void {
        this.eventSink.emit({
            type: 'isSurveyCandidateChanged',
            isSurveyCandidate: !getIsSurveyDisabledGlobally(),
        });
    }
}
