/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TypedEventSink } from '@microsoft/vscode-ext-webview';
import { attachTrpc } from '@microsoft/vscode-ext-webview/host';
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

    protected constructor(panel: vscode.WebviewPanel) {
        super(panel, DataModelingWizardTab.viewType);
        DataModelingWizardTab.openTabs.add(this);

        this.eventSink = new TypedEventSink<DataModelingEvent>();

        const { disposable } = attachTrpc(
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

        const panel = vscode.window.createWebviewPanel(DataModelingWizardTab.viewType, l10n.t('Data Modeler'), column, {
            enableScripts: true,
            retainContextWhenHidden: true,
        });

        return new DataModelingWizardTab(panel);
    }

    /** Finds the tab that originated a recommendation request. */
    public static findById(tabId: string): DataModelingWizardTab | undefined {
        return [...DataModelingWizardTab.openTabs].find((tab) => tab.getId() === tabId);
    }

    /** Stable tab id used to route asynchronous Copilot recommendations. */
    public getId(): string {
        return this.id;
    }

    /** Push a Copilot-produced recommendation to the webview's Result page. */
    public reportRecommendation(recommendation: PartitionKeyRecommendation): void {
        console.log(
            `[DataModelingWizardTab] emitting 'recommendationReceived' to event sink ` +
                `(${recommendation.containers.length} container(s)).`,
        );
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
            wizardTabId: this.getId(),
        };
    }
}
