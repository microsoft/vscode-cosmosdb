/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type JSONSchema } from '@azure/cosmosdb-schema-analyzer';
import { TypedEventSink } from '@microsoft/vscode-ext-webview';
import { attachTrpc } from '@microsoft/vscode-ext-webview/host';
import * as vscode from 'vscode';
import { getThemedIconPath } from '../constants';
import { getCosmosDBKeyCredential } from '../cosmosdb/CosmosDBCredential';
import { type NoSqlQueryConnection } from '../cosmosdb/NoSqlQueryConnection';
import { type QuerySession } from '../cosmosdb/session/QuerySession';
import { DEFAULT_EXECUTION_TIMEOUT, type SerializedQueryResult } from '../cosmosdb/types/queryResult';
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
import { cleanUpSupersededReadSessions } from './trpc/querySessionIsolation';
import { type QueryEditorEvent } from './trpc/routers/queryEditorEventsRouter';

export class QueryEditorTab extends BaseTab {
    public static readonly title = 'Query Editor';
    public static readonly viewType = 'cosmosDbQuery';
    public static readonly openTabs: Set<QueryEditorTab> = new Set<QueryEditorTab>();

    public readonly sessions = new Map<string, QuerySession>();
    public readonly eventSink: TypedEventSink<QueryEditorEvent>;

    private readonly state: QueryEditorMutableState;
    private readonly readToolSessionIds = new Set<string>();
    private static readonly DEFAULT_QUERY_VALUE = `SELECT * FROM c`;

    protected constructor(panel: vscode.WebviewPanel, connection?: NoSqlQueryConnection, query?: string) {
        super(panel, QueryEditorTab.viewType, { hasConnection: connection ? 'true' : 'false' });

        QueryEditorTab.openTabs.add(this);

        this.state = {
            connection,
            query: query ?? QueryEditorTab.DEFAULT_QUERY_VALUE,
            isLastQueryAIGenerated: false,
            lastAIGeneratedQuery: undefined,
            lastGeneratePrompt: undefined,
            pendingRuns: new Map(),
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

        const { disposable } = attachTrpc(
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

        // Settle any in-flight runs so awaiting tool calls resolve immediately instead of hanging until
        // their timeout fires. Deleting the current entry during Map iteration does not skip remaining entries.
        for (const resolve of this.state.pendingRuns.values()) {
            resolve.resolve(undefined);
        }
        this.state.pendingRuns.clear();

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

    public getCurrentQueryResults = (executionId?: string): SerializedQueryResult | undefined => {
        // When an executionId is given, read that exact session so a caller (e.g. the
        // cosmosdb_executeCurrentQuery tool) never picks up a different / previous run's result.
        // Tool-owned sessions coexist while their callers await exact results. Once read, release
        // superseded sessions but retain the active result so pagination keeps working in the grid.
        const sessions = Array.from(this.sessions.values());
        const activeSession = executionId ? this.sessions.get(executionId) : sessions[sessions.length - 1];
        const result = activeSession?.sessionResult;
        const serializedResult = result?.getSerializedResult(1);
        if (executionId && activeSession) {
            this.readToolSessionIds.add(executionId);
            cleanUpSupersededReadSessions(this.sessions, this.readToolSessionIds);
        }
        return serializedResult;
    };

    public getConnection = (): NoSqlQueryConnection | undefined => {
        return this.state.connection;
    };

    /**
     * Stable identifier for this tab instance, unique for the lifetime of the tab. Used by the
     * `cosmosdb_executeCurrentQuery` tool to pin a run to the exact tab whose query the user
     * confirmed, so switching tabs while the confirmation prompt is open can't redirect the run to
     * a different tab.
     */
    public getId(): string {
        return this.id;
    }

    public getCurrentQuery = (): string | undefined => {
        return this.state.query;
    };

    public getSelectedQuery = (): string | undefined => {
        return this.state.selectedQuery;
    };

    public takeLastGeneratePrompt = (): string | undefined => {
        const prompt = this.state.lastGeneratePrompt;
        this.state.lastGeneratePrompt = undefined;
        return prompt;
    };

    public isActive(): boolean {
        return this.panel.active;
    }

    public isVisible(): boolean {
        return this.panel.visible;
    }

    /**
     * Brings this Query Editor tab to the foreground and gives it focus, making it the active
     * editor. Used by the `cosmosdb_focusQueryEditor` tool so subsequent Query Editor tools
     * (which target the active editor) operate on this tab.
     */
    public reveal(): void {
        this.panel.reveal();
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

    public static refreshThroughputBucketsForContainer(
        accountId: string,
        databaseId?: string,
        containerId?: string,
    ): void {
        for (const tab of QueryEditorTab.openTabs) {
            const connection = tab.state.connection;
            if (
                connection?.azureMetadata?.accountId === accountId &&
                (!databaseId || connection.databaseId === databaseId) &&
                (!containerId || connection.containerId === containerId)
            ) {
                tab.eventSink.emit({ type: 'throughputBucketsRefreshRequested' });
            }
        }
    }

    /**
     * Pushes an AI-generated query into the editor.
     *
     * @param editorText - The full text to display in the editor: the generated statement framed
     *   with the "Generated from" / "Previous query" comment blocks.
     * @param aiGeneratedQuery - The generated statement in isolation, already normalized (comments
     *   stripped, whitespace collapsed, trailing semicolon removed) to match how the editor text is
     *   normalized before execution. Stored so `createQuerySession` can detect whether the user
     *   edited the query before running it with a plain string comparison — no re-parsing needed.
     */
    public updateQuery(editorText: string, aiGeneratedQuery: string): void {
        this.state.query = editorText;
        this.state.selectedQuery = undefined;
        this.state.isLastQueryAIGenerated = true;
        this.state.lastAIGeneratedQuery = aiGeneratedQuery;
        this.eventSink.emit({ type: 'queryTextPushed', query: editorText });
    }

    /**
     * Asks the webview to run `query` in the Query Editor (so results appear in the grid) and
     * resolves once the webview reports completion via `reportActiveQueryExecuted`. Resolves with the
     * executionId of the run that actually happened, or `undefined` when the run was cancelled / never
     * started / timed out — so the `cosmosdb_executeCurrentQuery` tool reads PII-free result metadata
     * only for this run and never reports stale results. Resolves after `timeoutMs` (with `undefined`)
     * as a safety net so the tool never hangs.
     *
     * Each call gets a unique `requestId` that travels with the request event and comes back on the
     * completion signal, so concurrent invocations stay isolated: a completing run resolves only its
     * own caller and can never deliver its executionId to a different still-pending invocation.
     */
    public runActiveQueryInEditor(
        query: string,
        connection: { endpoint: string; databaseId: string; containerId: string },
        token: vscode.CancellationToken,
        timeoutMs = DEFAULT_EXECUTION_TIMEOUT + 30_000,
    ): Promise<string | undefined> {
        if (token.isCancellationRequested) {
            return Promise.resolve(undefined);
        }

        const requestId = globalThis.crypto.randomUUID();
        return new Promise<string | undefined>((resolve) => {
            let cancellationSubscription: vscode.Disposable = new vscode.Disposable(() => undefined);
            let isFinished = false;
            const finish = (executionId?: string): void => {
                if (isFinished) {
                    return;
                }
                isFinished = true;
                clearTimeout(timer);
                this.state.pendingRuns.delete(requestId);
                cancellationSubscription.dispose();
                resolve(executionId);
            };
            const cancel = (): void => {
                const pendingRun = this.state.pendingRuns.get(requestId);
                if (pendingRun?.executionId) {
                    const session = this.sessions.get(pendingRun.executionId);
                    this.sessions.delete(pendingRun.executionId);
                    session?.dispose();
                }
                finish(undefined);
            };
            const timer = setTimeout(cancel, timeoutMs);
            this.state.pendingRuns.set(requestId, { resolve: finish });
            cancellationSubscription = token.onCancellationRequested(cancel);
            if (isFinished) {
                cancellationSubscription.dispose();
            } else {
                this.eventSink.emit({ type: 'runActiveQueryRequested', query, requestId, connection });
            }
        });
    }

    public refreshSurveyFeedbackVisibility(): void {
        this.eventSink.emit({
            type: 'isSurveyCandidateChanged',
            isSurveyCandidate: !getIsSurveyDisabledGlobally(),
        });
    }
}
