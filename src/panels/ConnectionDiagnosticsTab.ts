/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { type BaseRouterContext } from '@microsoft/vscode-ext-webview';
import { attachTrpc } from '@microsoft/vscode-ext-webview/host';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { z } from 'zod';
import { type DiagnosticsState } from '../connectionDiagnostics/model';
import {
    copyDiagnosticsReport,
    saveDiagnosticsReport,
    showDiagnosticsReport,
} from '../connectionDiagnostics/reportActions';
import { assignDiagnosticsDataRole, type RoleActionOutcome } from '../connectionDiagnostics/roleAction';
import { type DiagnosticsTarget, runDiagnostics } from '../connectionDiagnostics/run';
import { ext } from '../extensionVariables';
import { BaseTab } from './BaseTab';
import { diagnosticsAction, diagnosticsCallerFactory, diagnosticsProgress, diagnosticsRouter } from './trpc/trpc';

export type DiagnosticsRouterContext = BaseRouterContext & {
    actionContext?: IActionContext;
    getState(): DiagnosticsState;
    rerun(): void;
    cancel(): void;
    addDataRole(runId: string, context: IActionContext): Promise<RoleActionOutcome>;
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
    addDataRole: diagnosticsAction.input(z.object({ runId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
        if (!ctx.actionContext) return 'unavailable' as const;
        const state = ctx.getState();
        const current =
            state.kind === 'azure' &&
            state.phase === 'completed' &&
            state.trace?.runId === input.runId &&
            state.canAddDataRole &&
            state.checks.some((check) => check.finding === 'dataRbac');
        const outcome = current ? await ctx.addDataRole(input.runId, ctx.actionContext) : 'unavailable';
        const properties = ctx.actionContext.telemetry.properties;
        if (current) properties.diagnosticsRunId = input.runId;
        properties.roleActionOutcome = outcome;
        if (outcome === 'cancelled') properties.result = 'Canceled';
        if (outcome === 'failed' || outcome === 'denied') properties.result = 'Failed';
        return outcome;
    }),
});
export type ConnectionDiagnosticsRouter = typeof connectionDiagnosticsRouter;

export class ConnectionDiagnosticsTab extends BaseTab {
    private static readonly viewType = 'cosmosDbConnectionDiagnostics';
    private static readonly tabs = new Map<string, ConnectionDiagnosticsTab>();
    private state: DiagnosticsState;
    private controller?: AbortController;
    private applyingRole = false;
    private roleTarget?: { account: Extract<DiagnosticsTarget, { kind: 'azure' }>['account']; principalId: string };

    private constructor(
        panel: vscode.WebviewPanel,
        private target: DiagnosticsTarget,
    ) {
        super(panel, ConnectionDiagnosticsTab.viewType);
        this.telemetryContext.addMaskedValue([target.account.id, target.account.name]);
        this.state = { kind: target.kind, phase: 'running', checks: [] };
        try {
            const context: DiagnosticsRouterContext = {
                getState: () => ({
                    ...this.state,
                    connectionName: this.target.account.name,
                    canAddDataRole: this.state.phase === 'completed' && !!this.roleTarget,
                }),
                rerun: () => this.startRun(),
                cancel: () => this.controller?.abort(),
                addDataRole: (runId, actionContext) => this.addDataRole(runId, actionContext),
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
        if (this.isDisposed || this.controller || this.applyingRole) return;
        this.roleTarget = undefined;
        const target = this.target;
        const controller = new AbortController();
        this.controller = controller;
        void runDiagnostics(
            target,
            controller.signal,
            (state) => {
                if (this.isDisposed) return;
                this.state = state;
                if (state.phase !== 'running') this.controller = undefined;
            },
            (principalId) => {
                if (!this.isDisposed && target.kind === 'azure')
                    this.roleTarget = { account: target.account, principalId };
            },
        );
    }

    private async addDataRole(runId: string, context: IActionContext): Promise<RoleActionOutcome> {
        const roleTarget = this.roleTarget;
        const isCurrent = () =>
            !this.isDisposed &&
            this.state.phase === 'completed' &&
            runId === this.state.trace?.runId &&
            roleTarget === this.roleTarget &&
            roleTarget?.account.id === this.target.account.id;
        if (!roleTarget || this.applyingRole || !isCurrent()) return 'unavailable';
        this.applyingRole = true;
        try {
            const outcome = await assignDiagnosticsDataRole(
                context,
                roleTarget.account,
                roleTarget.principalId,
                isCurrent,
            );
            if (outcome === 'assigned') this.roleTarget = undefined;
            return outcome;
        } finally {
            this.applyingRole = false;
        }
    }
}
