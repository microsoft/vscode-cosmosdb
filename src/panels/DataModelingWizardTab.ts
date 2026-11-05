/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TypedEventSink } from '@microsoft/vscode-ext-webview';
import { attachTrpc } from '@microsoft/vscode-ext-webview/host';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ModelingTelemetry } from '../dataModeling/ModelingTelemetry';
import { ext } from '../extensionVariables';
import { DataModelerProjectService, type DataModelerAccount } from '../services/DataModelerProjectService';
import { createInitialSnapshot } from '../webviews/cosmosdb/DataModeling/dataModel';
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
    private static readonly pendingTabs = new Map<DataModelerProjectService, Promise<DataModelingWizardTab>>();

    public readonly eventSink: TypedEventSink<DataModelingEvent>;
    public readonly modelingTelemetry: ModelingTelemetry;

    protected constructor(
        panel: vscode.WebviewPanel,
        private readonly project: DataModelerProjectService,
        private readonly account: DataModelerAccount,
    ) {
        super(panel, DataModelingWizardTab.viewType);
        DataModelingWizardTab.openTabs.add(this);

        this.eventSink = new TypedEventSink<DataModelingEvent>();
        this.modelingTelemetry = new ModelingTelemetry(panel.visible, Date.now, this.id);
        this.disposables.push(
            panel.onDidChangeViewState(({ webviewPanel }) => this.modelingTelemetry.setVisible(webviewPanel.visible)),
        );

        const { disposable } = attachTrpc(
            this.panel,
            this.buildRouterContext(),
            dataModelingAppRouter,
            dataModelingCallerFactory,
        );
        this.disposables.push(disposable);
    }

    public static async render(
        account: DataModelerAccount,
        viewColumn?: vscode.ViewColumn,
    ): Promise<DataModelingWizardTab> {
        const column = viewColumn ?? vscode.ViewColumn.Active;
        const project = DataModelerProjectService.getInstance(account.endpoint);

        // Reuse an already-open wizard tab rather than stacking duplicates.
        const pending = this.pendingTabs.get(project);
        const existing = pending
            ? await pending
            : [...DataModelingWizardTab.openTabs].find((tab) => tab.project === project);
        if (existing) {
            if (account.getControlPlane) {
                existing.account.getControlPlane = account.getControlPlane;
            }
            if (account.getDeploymentTarget) {
                existing.account.getDeploymentTarget = account.getDeploymentTarget;
            }
            if (account.getQueryConnection) {
                existing.account.getQueryConnection = account.getQueryConnection;
            }
            existing.panel.reveal(column);
            return existing;
        }

        const opening = this.openNew(account, project, column);
        this.pendingTabs.set(project, opening);
        try {
            return await opening;
        } finally {
            this.pendingTabs.delete(project);
        }
    }

    private static async openNew(
        account: DataModelerAccount,
        project: DataModelerProjectService,
        column: vscode.ViewColumn,
    ): Promise<DataModelingWizardTab> {
        const saved = await project.loadState();
        let choice: 'new' | 'continued' | 'replaced' = saved ? 'continued' : 'new';
        if (saved) {
            const yes = { title: l10n.t('Yes') };
            const no = { title: l10n.t('No'), isCloseAffordance: true };
            const answer = await vscode.window.showWarningMessage(
                l10n.t('Start a new data model?'),
                {
                    modal: true,
                    detail: l10n.t(
                        'A saved data model was found. Choose Yes to start a new model and replace the saved one, or No to continue where you left off.',
                    ),
                },
                yes,
                no,
            );
            if (answer === yes) {
                await project.saveState(createInitialSnapshot());
                choice = 'replaced';
            }
        }

        const panel = vscode.window.createWebviewPanel(
            DataModelingWizardTab.viewType,
            account.name ? l10n.t('Data Modeler: {name}', { name: account.name }) : l10n.t('Data Modeler'),
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
            },
        );

        const tab = new DataModelingWizardTab(panel, project, { ...account });
        tab.modelingTelemetry.record({ type: 'sessionChoice', choice });
        if (choice === 'replaced') tab.modelingTelemetry.persistenceSave(true);
        return tab;
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
    public reportRecommendation(recommendation: PartitionKeyRecommendation, requestId?: string): void {
        if (!this.modelingTelemetry.recommendationReceived(recommendation, requestId)) return;
        ext.outputChannel.info(
            `[DataModelingWizardTab] emitting 'recommendationReceived' ` +
                `(${recommendation.containers.length} container(s)) to the webview.`,
        );
        this.eventSink.emit({ type: 'recommendationReceived', recommendation, ...(requestId ? { requestId } : {}) });
    }

    /** Notify the webview that the recommendation could not be produced. */
    public reportRecommendationError(
        message: string,
        requestId?: string,
        category: 'ai' | 'invalidResult' = 'ai',
    ): void {
        if (!this.modelingTelemetry.acceptsResponse(requestId)) return;
        if (!this.modelingTelemetry.recommendationFailed(requestId, category)) return;
        ext.outputChannel.warn(`[DataModelingWizardTab] emitting 'recommendationError' to the webview.`);
        this.eventSink.emit({ type: 'recommendationError', message, ...(requestId ? { requestId } : {}) });
    }

    public dispose(): void {
        if (this.isDisposed) return;
        this.modelingTelemetry.dispose();
        DataModelingWizardTab.openTabs.delete(this);
        this.eventSink.close();
        super.dispose();
    }

    private buildRouterContext(): DataModelingRouterContext {
        return {
            project: this.project,
            account: this.account,
            webviewName: DataModelingWizardTab.viewType,
            panel: this.panel,
            eventSink: this.eventSink,
            wizardTabId: this.getId(),
            modelingTelemetry: this.modelingTelemetry,
        };
    }
}
