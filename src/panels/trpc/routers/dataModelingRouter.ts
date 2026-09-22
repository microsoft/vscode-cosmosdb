/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { z } from 'zod';
import {
    deployDataModel,
    generateDeploymentTemplate,
    getDeploymentOptions,
} from '../../../commands/dataModeling/deployDataModel';
import { DeploymentRequestSchema, GenerateDeploymentTemplateInputSchema } from '../../../dataModeling/deploymentModel';
import { ModelingAdvisorSnapshotSchema, WizardStateSchema } from '../../../dataModeling/modelingAdvisorSchema';
import { ModelingTelemetryEventSchema } from '../../../dataModeling/modelingTelemetrySchema';
import { buildRecommendationPrompt } from '../../../dataModeling/recommendationPrompt';
import { openUrl } from '../../../utils/openUrl';
import { dataModelingProcedure, dataModelingRouter } from '../trpc';

export { buildRecommendationPrompt } from '../../../dataModeling/recommendationPrompt';

type RequestWizardState = z.output<typeof WizardStateSchema>;
// WizardStateSchema's declared input is unknown; retain the complete caller contract at the tRPC boundary.
const RecommendationRequestSchema = z.intersection(
    WizardStateSchema as z.ZodType<RequestWizardState, RequestWizardState>,
    z.object({ requestId: z.string().uuid().optional() }),
);

// Modeling requests, autosaves, and deployments contain user inputs and AI output. Suppress validation telemetry too.
// The webview presents request/storage failures; deployment helpers also show native VS Code notifications.
const stateProcedure = dataModelingProcedure.use(({ ctx, next }) => {
    if (ctx.actionContext) {
        ctx.actionContext.telemetry.suppressAll = true;
        ctx.actionContext.errorHandling.suppressDisplay = true;
    }
    return next();
});

export const dataModelingRouterDef = dataModelingRouter({
    recordTelemetry: stateProcedure.input(ModelingTelemetryEventSchema).mutation(({ ctx, input }) => {
        ctx.modelingTelemetry?.record(input);
    }),
    confirm: stateProcedure
        .input(z.object({ message: z.string().min(1), detail: z.string() }))
        .mutation(async ({ input }) => {
            const yes = { title: l10n.t('Yes') };
            const no = { title: l10n.t('No') };
            const choice = await vscode.window.showWarningMessage(
                input.message,
                { modal: true, detail: input.detail },
                yes,
                no,
            );
            return choice === yes ? true : choice === no ? false : undefined;
        }),
    loadState: stateProcedure.query(async ({ ctx }) => {
        try {
            const state = await ctx.project.loadState();
            ctx.modelingTelemetry?.persistenceLoad(true, state !== null);
            return state;
        } catch (error) {
            ctx.modelingTelemetry?.persistenceLoad(false);
            throw error;
        }
    }),
    saveState: stateProcedure.input(ModelingAdvisorSnapshotSchema).mutation(async ({ ctx, input }) => {
        try {
            await ctx.project.saveState(input);
            ctx.modelingTelemetry?.persistenceSave(true);
        } catch (error) {
            ctx.modelingTelemetry?.persistenceSave(false);
            throw error;
        }
    }),
    getDeploymentOptions: stateProcedure.query(({ ctx }) => getDeploymentOptions(ctx.account)),
    generateDeploymentTemplate: stateProcedure
        .input(GenerateDeploymentTemplateInputSchema)
        .query(async ({ ctx, input }) => {
            const started = Date.now();
            try {
                const template = await generateDeploymentTemplate(ctx.account, input);
                ctx.modelingTelemetry?.export(
                    'success',
                    input.format ?? 'bicep',
                    input.databaseMode,
                    Date.now() - started,
                );
                return template;
            } catch (error) {
                ctx.modelingTelemetry?.export(
                    'error',
                    input.format ?? 'bicep',
                    input.databaseMode,
                    Date.now() - started,
                );
                throw error;
            }
        }),
    deploy: stateProcedure.input(DeploymentRequestSchema).mutation(({ ctx, input }) => {
        if (!ctx.actionContext) throw new Error(l10n.t('Reopen the Data Modeler to deploy this model.'));
        return deployDataModel(
            ctx.account,
            input,
            ctx.actionContext,
            ctx.modelingTelemetry ? (result) => ctx.modelingTelemetry?.deployment(result) : undefined,
        );
    }),
    openDataExplorer: stateProcedure
        .input(z.object({ databaseId: z.string().min(1), containerId: z.string().min(1) }))
        .mutation(async ({ ctx }) => {
            const started = Date.now();
            try {
                const metadata = ctx.account.getDeploymentTarget?.();
                if (!metadata) {
                    throw new Error(l10n.t('Reopen the Data Modeler from an Azure account to open Data Explorer.'));
                }
                await openUrl(
                    `${metadata.subscription.environment.portalUrl}/#@${metadata.subscription.tenantId}/resource${metadata.accountId}/DataExplorerBlade`,
                );
                ctx.modelingTelemetry?.openDataExplorer('success', Date.now() - started);
            } catch (error) {
                ctx.modelingTelemetry?.openDataExplorer('error', Date.now() - started);
                throw error;
            }
        }),
    /**
     * Sends the finished data model to the general Copilot Chat with a prompt
     * asking for the best partition key. Copilot analyzes it and calls the
     * report tool, whose result is streamed back to the Result page.
     */
    requestRecommendation: stateProcedure.input(RecommendationRequestSchema).mutation(async ({ input, ctx }) => {
        if (ctx.actionContext) {
            ctx.actionContext.valuesToMask.push(JSON.stringify(input.dataModel));
        }

        ctx.modelingTelemetry?.beginRecommendation(
            input.requestId,
            input.dataModel.containers.map((container) => container.entity),
            input,
        );
        try {
            await vscode.commands.executeCommand('workbench.action.chat.open', {
                mode: 'agent',
                query: await buildRecommendationPrompt(input, ctx.wizardTabId, input.requestId),
            });
        } catch (error) {
            ctx.modelingTelemetry?.recommendationFailed(input.requestId, 'chat');
            throw error;
        }
    }),
});
