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
import { diagnosticsHelpUrls, type DiagnosticsHelpTopic } from '../connectionDiagnostics/help';
import { type DiagnosticsState } from '../connectionDiagnostics/model';
import {
    copyDiagnosticsReport,
    saveDiagnosticsReport,
    showDiagnosticsReport,
} from '../connectionDiagnostics/reportActions';
import { assignDiagnosticsDataRole, type RoleActionOutcome } from '../connectionDiagnostics/roleAction';
import {
    type DiagnosticsAzureAccount,
    type DiagnosticsTarget,
    getDiagnosticsAzureAccount,
    runDiagnostics,
} from '../connectionDiagnostics/run';
import { maskConnectionTelemetry } from '../cosmosdb/maskConnectionTelemetry';
import { type NoSqlQueryConnection } from '../cosmosdb/NoSqlQueryConnection';
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
    openHelp: diagnosticsAction
        .input(z.enum(Object.keys(diagnosticsHelpUrls) as [DiagnosticsHelpTopic, ...DiagnosticsHelpTopic[]]))
        .mutation(async ({ ctx, input }) => {
            try {
                if (await vscode.env.openExternal(vscode.Uri.parse(diagnosticsHelpUrls[input]))) return true;
            } catch {
                // Only the bounded topic and outcome are recorded; browser errors may contain local paths.
            }
            if (ctx.actionContext) ctx.actionContext.telemetry.properties.result = 'Failed';
            ext.outputChannel.warn(`[Connection diagnostics] Could not open help topic: ${input}`);
            return false;
        }),
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
    private static readonly tabs = new Map<string | NoSqlQueryConnection, ConnectionDiagnosticsTab>();
    private state: DiagnosticsState;
    private controller?: AbortController;
    private applyingRole = false;
    private roleTarget?: { account: DiagnosticsAzureAccount; principalId: string };

    private constructor(
        panel: vscode.WebviewPanel,
        private target: DiagnosticsTarget,
    ) {
        super(panel, ConnectionDiagnosticsTab.viewType);
        if (target.kind === 'queryEditor') {
            const masks: string[] = [];
            maskConnectionTelemetry({ valuesToMask: masks }, target.connection);
            this.telemetryContext.addMaskedValue(masks);
        } else {
            this.telemetryContext.addMaskedValue([target.account.id, target.account.name]);
        }
        this.state = {
            kind: getDiagnosticsAzureAccount(target)
                ? 'azure'
                : target.kind === 'queryEditor' && target.connection.isEmulator
                  ? 'emulator'
                  : target.kind,
            scope: target.kind === 'queryEditor' ? 'container' : undefined,
            phase: 'running',
            checks: [],
        };
        try {
            const context: DiagnosticsRouterContext = {
                getState: () => ({
                    ...this.state,
                    connectionName: ConnectionDiagnosticsTab.connectionName(this.target),
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
        const key = target.kind === 'queryEditor' ? target.connection : `${target.kind}:${target.account.id}`;
        const existing = this.tabs.get(key);
        if (existing) {
            existing.target = target;
            existing.panel.reveal();
            return;
        }
        const panel = vscode.window.createWebviewPanel(
            this.viewType,
            l10n.t('Connection diagnostics: {0}', this.connectionName(target)),
            vscode.ViewColumn.Active,
            { enableScripts: true },
        );
        const tab = new ConnectionDiagnosticsTab(panel, target);
        this.tabs.set(key, tab);
        tab.onDisposed(() => this.tabs.delete(key));
    }

    private static connectionName(target: DiagnosticsTarget): string {
        return target.kind === 'queryEditor'
            ? `${target.connection.databaseId} / ${target.connection.containerId}`
            : target.account.name;
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
            (principalId, account) => {
                if (!this.isDisposed) this.roleTarget = { account, principalId };
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
            roleTarget?.account.id === getDiagnosticsAzureAccount(this.target)?.id;
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
