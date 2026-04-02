/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { getThemedIconPath } from '../constants';
import { getCosmosDBKeyCredential } from '../cosmosdb/CosmosDBCredential';
import { type NoSqlQueryConnection } from '../cosmosdb/NoSqlQueryConnection';
import { type QuerySession } from '../cosmosdb/session/QuerySession';
import { type SerializedQueryResult } from '../cosmosdb/types/queryResult';
import { getIsSurveyDisabledGlobally } from '../utils/survey';
import { TypedEventSink } from '../utils/TypedEventSink';
import { type QueryEditorRouterContext } from '../webviews/api/configuration/appRouter';
import { type QueryEditorEvent } from '../webviews/api/configuration/routers/queryEditorEventsRouter';
import { setupTrpc } from '../webviews/api/extension-server/setupTrpc';
import { BaseTab } from './BaseTab';

export class QueryEditorTab extends BaseTab {
    public static readonly title = 'Query Editor';
    public static readonly viewType = 'cosmosDbQuery';
    public static readonly openTabs: Set<QueryEditorTab> = new Set<QueryEditorTab>();

    public readonly sessions = new Map<string, QuerySession>();
    public readonly eventSink: TypedEventSink<QueryEditorEvent>;

    private connection: NoSqlQueryConnection | undefined;
    private query: string | undefined;
    private isLastQueryAIGenerated: boolean = false;
    /** The raw AI-generated query text, used to detect if the user modified it before running */
    private lastAIGeneratedQuery: string | undefined;
    private lastGenerationFailed: boolean = false;
    private generateQueryCancellation: vscode.CancellationTokenSource | undefined;
    private pendingConfirmResolve: ((confirmed: boolean) => void) | undefined;

    protected constructor(panel: vscode.WebviewPanel, connection?: NoSqlQueryConnection, query?: string) {
        super(panel, QueryEditorTab.viewType, { hasConnection: connection ? 'true' : 'false' });

        QueryEditorTab.openTabs.add(this);

        this.connection = connection;
        this.query = query;

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

        const { disposable } = setupTrpc(this.panel, this.buildRouterContext());
        this.disposables.push(disposable);
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
                    openTab.connection?.endpoint === connection.endpoint &&
                    openTab.connection?.databaseId === connection.databaseId &&
                    openTab.connection?.containerId === connection.containerId,
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

    private buildRouterContext(): QueryEditorRouterContext {
        // We need `self` because getter/setter `this` inside the object literal
        // refers to the routerContext object, not the QueryEditorTab instance.
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const self = this;
        return {
            dbExperience: 'NoSQL' as QueryEditorRouterContext['dbExperience'],
            webviewName: QueryEditorTab.viewType,
            get connection() {
                return self.connection;
            },
            sessions: this.sessions,
            telemetryContext: this.telemetryContext,
            panel: this.panel,
            eventSink: this.eventSink,
            get query() {
                return self.query;
            },
            set query(v) {
                self.query = v;
            },
            get isLastQueryAIGenerated() {
                return self.isLastQueryAIGenerated;
            },
            set isLastQueryAIGenerated(v) {
                self.isLastQueryAIGenerated = v;
            },
            get lastAIGeneratedQuery() {
                return self.lastAIGeneratedQuery;
            },
            set lastAIGeneratedQuery(v) {
                self.lastAIGeneratedQuery = v;
            },
            get lastGenerationFailed() {
                return self.lastGenerationFailed;
            },
            set lastGenerationFailed(v) {
                self.lastGenerationFailed = v;
            },
            get generateQueryCancellation() {
                return self.generateQueryCancellation;
            },
            set generateQueryCancellation(v) {
                self.generateQueryCancellation = v;
            },
            get pendingConfirmResolve() {
                return self.pendingConfirmResolve;
            },
            set pendingConfirmResolve(v) {
                self.pendingConfirmResolve = v;
            },
            setConnection: (conn) => {
                self.connection = conn;
            },
        };
    }

    public getCurrentQueryResults = (): SerializedQueryResult | undefined => {
        const activeSession = this.sessions.values().next().value as QuerySession | undefined;
        const result = activeSession?.sessionResult;
        return result?.getSerializedResult(1);
    };

    public getConnection = (): NoSqlQueryConnection | undefined => {
        return this.connection;
    };

    public getCurrentQuery = (): string | undefined => {
        return this.query;
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
        this.query = query;
        this.isLastQueryAIGenerated = true;
        this.lastAIGeneratedQuery = query;
        this.eventSink.emit({ type: 'fileOpened', query });
    }

    public async refreshSurveyFeedbackVisibility(): Promise<void> {
        this.eventSink.emit({
            type: 'isSurveyCandidateChanged',
            isSurveyCandidate: !getIsSurveyDisabledGlobally(),
        });
    }
}
