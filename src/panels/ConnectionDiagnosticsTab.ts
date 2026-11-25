/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { attachTrpc } from '@microsoft/vscode-ext-webview/host';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { type DiagnosticsState } from '../connectionDiagnostics/model';
import { assignDiagnosticsDataRole, type RoleActionOutcome } from '../connectionDiagnostics/roleAction';
import {
    type DiagnosticsAzureAccount,
    type DiagnosticsTarget,
    getDiagnosticsAzureAccount,
    runDiagnostics,
} from '../connectionDiagnostics/run';
import { maskConnectionTelemetry } from '../cosmosdb/maskConnectionTelemetry';
import { type NoSqlQueryConnection } from '../cosmosdb/NoSqlQueryConnection';
import { BaseTab } from './BaseTab';
import { connectionDiagnosticsRouter, type DiagnosticsRouterContext } from './trpc/routers/connectionDiagnosticsRouter';
import { diagnosticsCallerFactory } from './trpc/trpc';

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
