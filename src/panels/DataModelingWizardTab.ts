/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TypedEventSink } from '@cosmosdb/webview-rpc';
import { setupTrpc } from '@cosmosdb/webview-rpc/server';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { BaseTab } from './BaseTab';
import { dataModelingAppRouter, dataModelingCallerFactory, type DataModelingRouterContext } from './trpc/appRouter';
import { type DataModelingEvent, type PartitionKeyRecommendation } from './trpc/routers/dataModelingEventsRouter';

/**
 * Editor webview panel host for the Data-Modeling (Partition Key Advisor)
 * wizard. Hosts a tRPC channel so the wizard can request a partition-key
 * recommendation from Copilot and receive the result (delivered by the
 * `cosmosdb_reportPartitionKeyRecommendation` tool) over an event stream.
 */
export class DataModelingWizardTab extends BaseTab {
    public static readonly viewType = 'cosmosDbDataModeling';
    public static readonly openTabs: Set<DataModelingWizardTab> = new Set<DataModelingWizardTab>();

    public readonly eventSink: TypedEventSink<DataModelingEvent>;

    private isActive = true;

    protected constructor(panel: vscode.WebviewPanel) {
        super(panel, DataModelingWizardTab.viewType);
        DataModelingWizardTab.openTabs.add(this);

        this.eventSink = new TypedEventSink<DataModelingEvent>();

        this.disposables.push(
            this.panel.onDidChangeViewState((e) => {
                this.isActive = e.webviewPanel.active;
            }),
        );

        const { disposable } = setupTrpc(
            this.panel,
            this.buildRouterContext(),
            dataModelingAppRouter,
            dataModelingCallerFactory,
        );
        this.disposables.push(disposable);
    }

    public static render(viewColumn?: vscode.ViewColumn): DataModelingWizardTab {
        const column = viewColumn ?? vscode.ViewColumn.Active;

        // Reuse an already-open wizard tab rather than stacking duplicates.
        const existing = [...DataModelingWizardTab.openTabs][0];
        if (existing) {
            existing.panel.reveal(column);
            return existing;
        }

        const panel = vscode.window.createWebviewPanel(
            DataModelingWizardTab.viewType,
            l10n.t('Data Modeling'),
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
            },
        );

        return new DataModelingWizardTab(panel);
    }

    /** The tab a tool should deliver a recommendation to: the active one, else the first open. */
    public static getActiveTab(): DataModelingWizardTab | undefined {
        const tabs = [...DataModelingWizardTab.openTabs];
        return tabs.find((tab) => tab.isActive) ?? tabs[0];
    }

    /** Push a Copilot-produced recommendation to the webview's Result page. */
    public reportRecommendation(recommendation: PartitionKeyRecommendation): void {
        this.eventSink.emit({ type: 'recommendationReceived', recommendation });
    }

    /** Notify the webview that the recommendation could not be produced. */
    public reportRecommendationError(message: string): void {
        this.eventSink.emit({ type: 'recommendationError', message });
    }

    public dispose(): void {
        DataModelingWizardTab.openTabs.delete(this);
        this.eventSink.close();
        super.dispose();
    }

    private buildRouterContext(): DataModelingRouterContext {
        return {
            webviewName: DataModelingWizardTab.viewType,
            panel: this.panel,
            eventSink: this.eventSink,
        };
    }
}
