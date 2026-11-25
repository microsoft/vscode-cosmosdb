/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { type BaseRouterContext } from '@microsoft/vscode-ext-webview';
import { attachTrpc } from '@microsoft/vscode-ext-webview/host';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { type DiagnosticsState } from '../connectionDiagnostics/model';
import {
    copyDiagnosticsReport,
    saveDiagnosticsReport,
    showDiagnosticsReport,
} from '../connectionDiagnostics/reportActions';
import { type DiagnosticsTarget, runDiagnostics } from '../connectionDiagnostics/run';
import { ext } from '../extensionVariables';
import { BaseTab } from './BaseTab';
import { diagnosticsAction, diagnosticsCallerFactory, diagnosticsProgress, diagnosticsRouter } from './trpc/trpc';

export type DiagnosticsRouterContext = BaseRouterContext & {
    actionContext?: IActionContext;
    getState(): DiagnosticsState;
    rerun(): void;
    cancel(): void;
};

const reportActions = { showReport: showDiagnosticsReport, copy: copyDiagnosticsReport, save: saveDiagnosticsReport };

function reportProcedure(action: keyof typeof reportActions) {
    return diagnosticsAction.mutation(async ({ ctx }) => {
        const state = ctx.getState();
        const outcome = await reportActions[action](state);
        const properties = ctx.actionContext?.telemetry.properties;
        if (properties) {
            if (state.trace) properties.diagnosticsRunId = state.trace.runId;
            properties.reportOutcome = outcome;
            if (outcome === 'cancelled') properties.result = 'Canceled';
            if (outcome === 'failed') properties.result = 'Failed';
        }
        return outcome;
    });
}

export const connectionDiagnosticsRouter = diagnosticsRouter({
    state: diagnosticsProgress.query(({ ctx }) => ctx.getState()),
    rerun: diagnosticsAction.mutation(({ ctx }) => {
        ctx.rerun();
        return ctx.getState();
    }),
    cancel: diagnosticsAction.mutation(({ ctx }) => ctx.cancel()),
    showReport: reportProcedure('showReport'),
    copy: reportProcedure('copy'),
    save: reportProcedure('save'),
    showOutput: diagnosticsAction.mutation(() => ext.outputChannel.show(true)),
});
export type ConnectionDiagnosticsRouter = typeof connectionDiagnosticsRouter;

export class ConnectionDiagnosticsTab extends BaseTab {
    private static readonly viewType = 'cosmosDbConnectionDiagnostics';
    private static readonly tabs = new Map<string, ConnectionDiagnosticsTab>();
    private state: DiagnosticsState;
    private controller?: AbortController;

    private constructor(
        panel: vscode.WebviewPanel,
        private target: DiagnosticsTarget,
    ) {
        super(panel, ConnectionDiagnosticsTab.viewType);
        this.telemetryContext.addMaskedValue([target.account.id, target.account.name]);
        this.state = { kind: target.kind, phase: 'running', checks: [] };
        try {
            const context: DiagnosticsRouterContext = {
                getState: () => ({ ...this.state, connectionName: this.target.account.name }),
                rerun: () => this.startRun(),
                cancel: () => this.controller?.abort(),
            };
            this.disposables.push(
                attachTrpc(panel, context, connectionDiagnosticsRouter, diagnosticsCallerFactory).disposable,
            );
        } catch (error) {
            this.dispose();
            throw error;
        }
        this.startRun();
    }

    static render(target: DiagnosticsTarget): void {
        const key = `${target.kind}:${target.account.id}`;
        const existing = this.tabs.get(key);
        if (existing) {
            existing.target = target;
            existing.panel.reveal();
            return;
        }
        const panel = vscode.window.createWebviewPanel(
            this.viewType,
            l10n.t('Connection diagnostics: {0}', target.account.name),
            vscode.ViewColumn.Active,
            { enableScripts: true },
        );
        const tab = new ConnectionDiagnosticsTab(panel, target);
        this.tabs.set(key, tab);
        tab.onDisposed(() => this.tabs.delete(key));
    }

    public override dispose(): void {
        this.controller?.abort();
        super.dispose();
    }

    private startRun(): void {
        if (this.isDisposed || this.controller) return;
        const controller = new AbortController();
        this.controller = controller;
        void runDiagnostics(this.target, controller.signal, (state) => {
            if (this.isDisposed) return;
            this.state = state;
            if (state.phase !== 'running') this.controller = undefined;
        });
    }
}
