/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { z } from 'zod';
import { ext } from '../../../extensionVariables';
import { type ProjectJson } from '../../../services/MigrationProjectService';
import { publicProcedure, router, trpcToTelemetry } from '../extension-server/trpc';

const SELECTED_MODEL_KEY = 'ms-azuretools.vscode-cosmosdb.migration.selectedModel';

export const migrationRouter = router({
    getAvailableModels: publicProcedure.use(trpcToTelemetry).query(async () => {
        try {
            const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
            const savedModelId = ext.context.globalState.get<string>(SELECTED_MODEL_KEY);

            return {
                models: models.map((m) => ({
                    id: m.id,
                    name: m.name,
                    family: m.family,
                    vendor: m.vendor,
                    maxInputTokens: m.maxInputTokens,
                })),
                savedModelId: savedModelId ?? null,
            };
        } catch {
            return { models: [], savedModelId: null };
        }
    }),

    setSelectedModel: publicProcedure
        .use(trpcToTelemetry)
        .input(z.object({ modelId: z.string() }))
        .mutation(async ({ input }) => {
            await ext.context.globalState.update(SELECTED_MODEL_KEY, input.modelId);
        }),

    updateProjectName: publicProcedure
        .use(trpcToTelemetry)
        .input(z.object({ name: z.string() }))
        .mutation(() => {
            // Handled by the tab's Channel command; tRPC definition provided for typed API surface
            return { success: true };
        }),

    getProjectStatus: publicProcedure.use(trpcToTelemetry).query(() => {
        return {
            isAIFeaturesEnabled: ext.isAIFeaturesEnabled,
        };
    }),

    setTargetEnvironment: publicProcedure
        .use(trpcToTelemetry)
        .input(
            z.object({
                type: z.enum(['emulator', 'azure']),
                connectionString: z.string().optional(),
            }),
        )
        .mutation(({ input }) => {
            return {
                type: input.type,
                connectionString: input.connectionString,
                verified: false,
            } satisfies NonNullable<ProjectJson['phases']['discovery']['targetEnvironment']>;
        }),
});

export type MigrationRouter = typeof migrationRouter;
