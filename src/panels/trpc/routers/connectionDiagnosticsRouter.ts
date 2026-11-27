/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { type BaseRouterContext } from '@microsoft/vscode-ext-webview';
import * as vscode from 'vscode';
import { z } from 'zod';
import { diagnosticsHelpUrls, type DiagnosticsHelpTopic } from '../../../connectionDiagnostics/help';
import { type DiagnosticsState } from '../../../connectionDiagnostics/model';
import {
    copyDiagnosticsReport,
    saveDiagnosticsReport,
    showDiagnosticsReport,
} from '../../../connectionDiagnostics/reportActions';
import { type RoleActionOutcome } from '../../../connectionDiagnostics/roleAction';
import { ext } from '../../../extensionVariables';
import { diagnosticsAction, diagnosticsProgress, diagnosticsRouter } from '../trpc';

export type DiagnosticsRouterContext = BaseRouterContext & {
    actionContext?: IActionContext;
    getState(): DiagnosticsState;
    getLocalTrace(): readonly string[];
    rerun(): void;
    cancel(): void;
    addDataRole(runId: string, context: IActionContext): Promise<RoleActionOutcome>;
};

function reportProcedure(
    action: (ctx: DiagnosticsRouterContext, state: DiagnosticsState) => ReturnType<typeof showDiagnosticsReport>,
) {
    return diagnosticsAction.mutation(async ({ ctx }) => {
        const state = ctx.getState();
        const outcome = await action(ctx, state);
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
    showReport: reportProcedure((ctx, state) => showDiagnosticsReport(state, ctx.getLocalTrace())),
    copy: reportProcedure((_, state) => copyDiagnosticsReport(state)),
    save: reportProcedure((_, state) => saveDiagnosticsReport(state)),
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
