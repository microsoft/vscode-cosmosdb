/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parseAzureResourceId } from '@microsoft/vscode-azext-azureutils';
import { callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { z } from 'zod';
import { getCosmosDBCredentials } from '../../../../cosmosdb/CosmosDBCredential';
import { maskConnectionTelemetry } from '../../../../cosmosdb/maskConnectionTelemetry';
import { type NoSqlQueryConnection } from '../../../../cosmosdb/NoSqlQueryConnection';
import { ext } from '../../../../extensionVariables';
import { revealAzureResourceInExplorer } from '../../../../vscodeUriHandler';
import { accountActionInput } from '../../../accountOverview/accountActions';
import { getAccountOverviewMaskedValues } from '../../../accountOverview/resourceMasking';
import { runAccountAction } from '../../../accountOverview/services/accountActions';
import { overviewErrorSchema, overviewEventSchema } from '../../../accountOverview/telemetryContract';
import { QueryEditorTab } from '../../../QueryEditorTab';
import { accountOverviewProcedure } from '../../trpc';

// ─── Zone: User actions ─────────────────────────────────────────────────────────
//
// Webview-triggered side effects (open URL, report telemetry, open the query
// editor, reveal in the tree). These are thin adapters over vscode/extension
// services and carry no dashboard-metrics logic.

export const actionsProcedures = {
    runAccountAction: accountOverviewProcedure.input(accountActionInput).mutation(async ({ ctx, input }) => {
        ctx.actionContext.telemetry.properties.action = input.action;
        return runAccountAction(ctx.actionContext, ctx.metadata, input);
    }),

    showOutput: accountOverviewProcedure.mutation(() => {
        ext.outputChannel.show(true);
    }),

    // Keep this route typed locally, like openUrl: the shared common router loses its procedure types.
    showErrorMessage: accountOverviewProcedure.input(z.object({ message: z.string() })).mutation(async ({ input }) => {
        await vscode.window.showErrorMessage(input.message);
    }),

    /**
     * Opens an external URL (e.g. an Azure portal deep link from the Active
     * Alerts aside or an Advisor "Learn more" link) in the user's browser.
     */
    openUrl: accountOverviewProcedure.input(z.object({ url: z.string() })).mutation(async ({ input }) => {
        const uri = vscode.Uri.parse(input.url);
        if (!(await vscode.env.openExternal(uri))) {
            throw new Error(l10n.t('Unable to open the link in your browser.'));
        }
    }),

    /** Bounded webview events only; no file contents, paths, or names are emitted. */
    reportEvent: accountOverviewProcedure.input(overviewEventSchema).mutation(async ({ ctx, input }) => {
        ctx.actionContext.telemetry.suppressIfSuccessful = true;
        await callWithTelemetryAndErrorHandling<void>(
            `cosmosDB.accountOverview.webview.${input.eventName}`,
            (telemetryContext) => {
                telemetryContext.errorHandling.suppressDisplay = true;
                telemetryContext.errorHandling.rethrow = false;
                telemetryContext.valuesToMask.push(...getAccountOverviewMaskedValues(ctx.metadata));
                if (ctx.panelId) {
                    telemetryContext.telemetry.properties.panelId = ctx.panelId;
                }
                for (const [key, value] of Object.entries(input.properties ?? {})) {
                    if (value !== undefined) {
                        telemetryContext.telemetry.properties[key] = value;
                    }
                }
            },
        );
    }),

    /** Client-side failure categories only; no file contents, paths, names, messages, or stacks are emitted. */
    reportError: accountOverviewProcedure.input(overviewErrorSchema).mutation(async ({ ctx, input }) => {
        ctx.actionContext.telemetry.suppressIfSuccessful = true;
        await callWithTelemetryAndErrorHandling('cosmosDB.accountOverview.webviewError', (context) => {
            context.errorHandling.suppressDisplay = true;
            context.errorHandling.rethrow = false;
            context.valuesToMask.push(...getAccountOverviewMaskedValues(ctx.metadata));
            context.telemetry.properties.errorCategory = 'webview';
            context.telemetry.properties.failureKind = input.kind;
            if (input.operation) {
                context.telemetry.properties.operation = input.operation;
            }
            if (ctx.panelId) {
                context.telemetry.properties.panelId = ctx.panelId;
            }
            throw new Error('Account Overview webview operation failed.');
        });
    }),

    /**
     * Opens the container in this extension's Query Editor — the closest
     * equivalent to the portal's "Open in Data Explorer" action.
     */
    openQueryEditor: accountOverviewProcedure
        .input(z.object({ databaseId: z.string(), containerId: z.string() }))
        .mutation(async ({ ctx, input }) => {
            const { metadata } = ctx;
            const credentials = await getCosmosDBCredentials({
                accountName: metadata.accountName,
                documentEndpoint: metadata.documentEndpoint,
                isEmulator: false,
                tenantId: metadata.subscription.tenantId,
                arm: metadata,
            });
            maskConnectionTelemetry(ctx.actionContext, { credentials });

            const connection: NoSqlQueryConnection = {
                azureMetadata: metadata,
                databaseId: input.databaseId,
                containerId: input.containerId,
                endpoint: metadata.documentEndpoint,
                credentials,
                isEmulator: false,
            };

            QueryEditorTab.render(connection);
        }),

    /**
     * Reveals the database/container node in the Azure Resources tree. Reuses the same
     * `revealAzureResourceInExplorer` helper the `vscode://` URI handler relies on, so both
     * entry points share one drill-down/verification implementation instead of duplicating it.
     */
    revealInTree: accountOverviewProcedure
        .input(z.object({ databaseId: z.string(), containerId: z.string() }))
        .mutation(async ({ ctx, input }) => {
            const { metadata } = ctx;
            const resourceId = parseAzureResourceId(metadata.accountId);
            await revealAzureResourceInExplorer(ctx.actionContext, resourceId, input.databaseId, input.containerId, {
                verifyAndResolve: false,
            });
        }),
};
