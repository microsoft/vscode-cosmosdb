/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type BaseRouterContext, initWebviewTrpc } from '@microsoft/vscode-ext-webview';
import { attachTrpc } from '@microsoft/vscode-ext-webview/host';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { type DiagnosticsState } from '../connectionDiagnostics/model';
import { renderReport } from '../connectionDiagnostics/presentation';
import { type DiagnosticsTarget, runDiagnostics } from '../connectionDiagnostics/run';
import { BaseTab } from './BaseTab';

type DiagnosticsRouterContext = BaseRouterContext & {
    getState(): DiagnosticsState;
    rerun(): void;
    cancel(): void;
};

const trpc = initWebviewTrpc<DiagnosticsRouterContext>();
const router = trpc.router({
    state: trpc.publicProcedure.query(({ ctx }) => ctx.getState()),
    rerun: trpc.publicProcedure.mutation(({ ctx }) => {
        ctx.rerun();
        return ctx.getState();
    }),
    cancel: trpc.publicProcedure.mutation(({ ctx }) => ctx.cancel()),
    copy: trpc.publicProcedure.mutation(async ({ ctx }) => {
        const state = ctx.getState();
        if (state.phase !== 'running') await vscode.env.clipboard.writeText(renderReport(state));
    }),
});
export type ConnectionDiagnosticsRouter = typeof router;

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
                getState: () => this.state,
                rerun: () => this.startRun(),
                cancel: () => this.controller?.abort(),
            };
            this.disposables.push(attachTrpc(panel, context, router, trpc.createCallerFactory).disposable);
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
