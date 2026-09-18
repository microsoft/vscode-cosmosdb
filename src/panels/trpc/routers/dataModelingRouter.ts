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
import { DeploymentRequestSchema, DeploymentTemplateInputSchema } from '../../../dataModeling/deploymentModel';
import { ModelingAdvisorSnapshotSchema, WizardStateSchema } from '../../../dataModeling/modelingAdvisorSchema';
import { buildRecommendationPrompt } from '../../../dataModeling/recommendationPrompt';
import { openUrl } from '../../../utils/openUrl';
import { dataModelingProcedure, dataModelingRouter } from '../trpc';

export { buildRecommendationPrompt } from '../../../dataModeling/recommendationPrompt';

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
    loadState: stateProcedure.query(({ ctx }) => ctx.project.loadState()),
    saveState: stateProcedure
        .input(ModelingAdvisorSnapshotSchema)
        .mutation(({ ctx, input }) => ctx.project.saveState(input)),
    getDeploymentOptions: stateProcedure.query(({ ctx }) => getDeploymentOptions(ctx.account)),
    generateDeploymentTemplate: stateProcedure
        .input(DeploymentTemplateInputSchema)
        .query(({ ctx, input }) => generateDeploymentTemplate(ctx.account, input)),
    deploy: stateProcedure.input(DeploymentRequestSchema).mutation(({ ctx, input }) => {
        if (!ctx.actionContext) throw new Error(l10n.t('Reopen the Data Modeler to deploy this model.'));
        return deployDataModel(ctx.account, input, ctx.actionContext);
    }),
    openDataExplorer: stateProcedure
        .input(z.object({ databaseId: z.string().min(1), containerId: z.string().min(1) }))
        .mutation(async ({ ctx }) => {
            const metadata = ctx.account.getDeploymentTarget?.();
            if (!metadata) {
                throw new Error(l10n.t('Reopen the Data Modeler from an Azure account to open Data Explorer.'));
            }
            await openUrl(
                `${metadata.subscription.environment.portalUrl}/#@${metadata.subscription.tenantId}/resource${metadata.accountId}/DataExplorerBlade`,
            );
        }),
    /**
     * Sends the finished data model to the general Copilot Chat with a prompt
     * asking for the best partition key. Copilot analyzes it and calls the
     * report tool, whose result is streamed back to the Result page.
     */
    requestRecommendation: stateProcedure.input(WizardStateSchema).mutation(async ({ input, ctx }) => {
        if (ctx.actionContext) {
            ctx.actionContext.valuesToMask.push(JSON.stringify(input.dataModel));
        }

        await vscode.commands.executeCommand('workbench.action.chat.open', {
            mode: 'agent',
            query: await buildRecommendationPrompt(input, ctx.wizardTabId),
        });
    }),
});
