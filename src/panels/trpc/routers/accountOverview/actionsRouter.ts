/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parseAzureResourceId } from '@microsoft/vscode-azext-azureutils';
import { callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { z } from 'zod';
import { getCosmosDBCredentials } from '../../../../cosmosdb/CosmosDBCredential';
import { type NoSqlQueryConnection } from '../../../../cosmosdb/NoSqlQueryConnection';
import { revealAzureResourceInExplorer } from '../../../../vscodeUriHandler';
import { QueryEditorTab } from '../../../QueryEditorTab';
import { type AccountOverviewRouterContext } from '../../appRouter';
import { accountOverviewProcedure } from '../../trpc';

// ─── Zone: User actions ─────────────────────────────────────────────────────────
//
// Webview-triggered side effects (open URL, report telemetry, open the query
// editor, reveal in the tree). These are thin adapters over vscode/extension
// services and carry no dashboard-metrics logic.

export const actionsProcedures = {
    /**
     * Opens an external URL (e.g. an Azure portal deep link from the Active
     * Alerts aside or an Advisor "Learn more" link) in the user's browser.
     */
    openUrl: accountOverviewProcedure
        .input(z.object({ url: z.string() }))
        .mutation(async ({ input }: { input: { url: string } }) => {
            await vscode.env.openExternal(vscode.Uri.parse(input.url));
        }),

    /**
     * Records a webview-originated telemetry event — e.g. `emptyStateShown`,
     * `recommendationClicked`, `deepLinkFollowed`, `drillInOpened`,
     * `refreshTicked`. Mirrors the shared `common.reportEvent` procedure, added
     * directly here because the merged `common` router collapses to a procedure
     * union on the account-overview client (see `openUrl`). Only bounded,
     * PII-free enum-like values are ever passed from the webview.
     */
    reportEvent: accountOverviewProcedure
        .input(
            z.object({
                eventName: z.string(),
                properties: z.optional(z.record(z.string(), z.string())),
                measurements: z.optional(z.record(z.string(), z.number())),
            }),
        )
        .mutation(
            ({
                input,
            }: {
                input: {
                    eventName: string;
                    properties?: Record<string, string>;
                    measurements?: Record<string, number>;
                };
            }) => {
                void callWithTelemetryAndErrorHandling<void>(
                    `cosmosDB.accountOverview.webview.${input.eventName}`,
                    (telemetryContext) => {
                        telemetryContext.errorHandling.suppressDisplay = true;
                        Object.assign(telemetryContext.telemetry.properties, input.properties ?? {});
                        Object.assign(telemetryContext.telemetry.measurements, input.measurements ?? {});
                    },
                );
            },
        ),

    /**
     * Opens the container in this extension's Query Editor — the closest
     * equivalent to the portal's "Open in Data Explorer" action.
     */
    openQueryEditor: accountOverviewProcedure
        .input(z.object({ databaseId: z.string(), containerId: z.string() }))
        .mutation(
            async ({
                ctx,
                input,
            }: {
                ctx: AccountOverviewRouterContext;
                input: { databaseId: string; containerId: string };
            }) => {
                const { metadata } = ctx;
                const credentials = await getCosmosDBCredentials({
                    accountName: metadata.accountName,
                    documentEndpoint: metadata.documentEndpoint,
                    isEmulator: false,
                    tenantId: metadata.subscription.tenantId,
                    arm: metadata,
                });

                const connection: NoSqlQueryConnection = {
                    azureMetadata: metadata,
                    databaseId: input.databaseId,
                    containerId: input.containerId,
                    endpoint: metadata.documentEndpoint,
                    credentials,
                    isEmulator: false,
                };

                QueryEditorTab.render(connection);
            },
        ),

    /**
     * Reveals the database/container node in the Azure Resources tree. Reuses the same
     * `revealAzureResourceInExplorer` helper the `vscode://` URI handler relies on, so both
     * entry points share one drill-down/verification implementation instead of duplicating it.
     */
    revealInTree: accountOverviewProcedure
        .input(z.object({ databaseId: z.string(), containerId: z.string() }))
        .mutation(
            async ({
                ctx,
                input,
            }: {
                ctx: AccountOverviewRouterContext;
                input: { databaseId: string; containerId: string };
            }) => {
                const { metadata } = ctx;
                const resourceId = parseAzureResourceId(metadata.accountId);
                await revealAzureResourceInExplorer(ctx.actionContext, resourceId, input.databaseId, input.containerId);
            },
        ),
};
