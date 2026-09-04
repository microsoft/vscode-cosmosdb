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
                await revealAzureResourceInExplorer(
                    ctx.actionContext,
                    resourceId,
                    input.databaseId,
                    input.containerId,
                    {
                        verifyAndResolve: false,
                    },
                );
            },
        ),

    /**
     * Footer action: create a database in this account. Passes the originating
     * account node (captured when the overview opened) so the create wizard is
     * scoped to this account; when it is unavailable the command falls back to
     * its own account picker.
     */
    addDatabase: accountOverviewProcedure.mutation(async ({ ctx }: { ctx: AccountOverviewRouterContext }) => {
        await vscode.commands.executeCommand('cosmosDB.createDatabase', ctx.accountNode);
    }),

    /**
     * Footer action: create a container. A container needs a target *database*,
     * which the overview does not have a node for, so the command prompts for the
     * database via its own picker.
     */
    addContainer: accountOverviewProcedure.mutation(async () => {
        await vscode.commands.executeCommand('cosmosDB.createContainer');
    }),

    /**
     * Footer action: delete this account. Passes the originating account node so
     * the delete wizard targets this account (it still shows its own name-bearing
     * confirmation); falls back to the command's picker when unavailable.
     */
    deleteAccount: accountOverviewProcedure.mutation(async ({ ctx }: { ctx: AccountOverviewRouterContext }) => {
        await vscode.commands.executeCommand('cosmosDB.deleteAccount', ctx.accountNode);
    }),

    /** Footer action: open the Data Modeler (Partition Key Advisor) wizard. */
    openDataModeler: accountOverviewProcedure.mutation(async () => {
        await vscode.commands.executeCommand('cosmosDB.dataModeling.open');
    }),
};
