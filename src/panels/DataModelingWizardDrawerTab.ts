/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TypedEventSink } from '@microsoft/vscode-ext-webview';
import { attachTrpc } from '@microsoft/vscode-ext-webview/host';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ext } from '../extensionVariables';
import { BaseTab } from './BaseTab';
import { dataModelingAppRouter, dataModelingCallerFactory, type DataModelingRouterContext } from './trpc/appRouter';
import { type DataModelingEvent, type PartitionKeyRecommendation } from './trpc/routers/dataModelingEventsRouter';

/**
 * Editor webview panel host for the Data-Modeling wizard rendered inside a
 * right-side Fluent UI Drawer (see the `cosmosDbDataModelingDrawer` view in the
 * webview registry). Behaves like {@link DataModelingWizardTab} but mounts the
 * drawer chrome instead of the full-page wizard.
 */
export class DataModelingWizardDrawerTab extends BaseTab {
    public static readonly viewType = 'cosmosDbDataModelingDrawer';
    public static readonly openTabs: Set<DataModelingWizardDrawerTab> = new Set<DataModelingWizardDrawerTab>();
    public readonly eventSink: TypedEventSink<DataModelingEvent>;

    protected constructor(panel: vscode.WebviewPanel) {
        super(panel, DataModelingWizardDrawerTab.viewType);
        DataModelingWizardDrawerTab.openTabs.add(this);

        this.eventSink = new TypedEventSink<DataModelingEvent>();

        const { disposable } = attachTrpc(
            this.panel,
            this.buildRouterContext(),
            dataModelingAppRouter,
            dataModelingCallerFactory,
        );
        this.disposables.push(disposable);
    }

    public static render(viewColumn?: vscode.ViewColumn): DataModelingWizardDrawerTab {
        const column = viewColumn ?? vscode.ViewColumn.Active;

        // Reuse an already-open drawer tab rather than stacking duplicates.
        const existing = [...DataModelingWizardDrawerTab.openTabs][0];
        if (existing) {
            existing.panel.reveal(column);
            return existing;
        }

        const panel = vscode.window.createWebviewPanel(
            DataModelingWizardDrawerTab.viewType,
            l10n.t('Data Modeler'),
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
            },
        );

        return new DataModelingWizardDrawerTab(panel);
    }

    /** Finds the drawer that originated a recommendation request. */
    public static findById(tabId: string): DataModelingWizardDrawerTab | undefined {
        return [...DataModelingWizardDrawerTab.openTabs].find((tab) => tab.getId() === tabId);
    }

    /** Stable tab id used to route asynchronous Copilot recommendations. */
    public getId(): string {
        return this.id;
    }

    /** Push a Copilot-produced recommendation to the webview's Result page. */
    public reportRecommendation(recommendation: PartitionKeyRecommendation): void {
        ext.outputChannel.info(
            `[DataModelingWizardDrawerTab] emitting 'recommendationReceived' ` +
                `(${recommendation.containers.length} container(s)) to the webview.`,
        );
        this.eventSink.emit({ type: 'recommendationReceived', recommendation });
    }

    /** Notify the webview that the recommendation could not be produced. */
    public reportRecommendationError(message: string): void {
        ext.outputChannel.warn(`[DataModelingWizardDrawerTab] emitting 'recommendationError' to the webview.`);
        this.eventSink.emit({ type: 'recommendationError', message });
    }

    public dispose(): void {
        DataModelingWizardDrawerTab.openTabs.delete(this);
        this.eventSink.close();
        super.dispose();
    }

    private buildRouterContext(): DataModelingRouterContext {
        return {
            webviewName: DataModelingWizardDrawerTab.viewType,
            panel: this.panel,
            eventSink: this.eventSink,
            wizardTabId: this.getId(),
        };
    }
}
