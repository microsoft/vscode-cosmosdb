/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { AssessmentServiceClient } from '../../../mongoMigration/assessmentService/assessmentServiceClient';
import { BaseRouterContext } from '../../api/configuration/appRouter';
import { publicProcedure, router, trpcToTelemetry } from '../../api/extension-server/trpc';

/**
 * Information shared during the life time of the webview
 */
async function getInstanceIdHash(connectionString: string): Promise<string> {
    const crypto = await import('crypto');
    return crypto.createHash('sha256').update(connectionString).digest('hex');
}

export const assessmentWizardInputs = {
    connectionString: '',
    instanceIdHash: '',
};

export type RouterContext = BaseRouterContext & {};
export const migrationPanelViewRouter = router({
    startAssessment: publicProcedure
        .input(
            z.object({
                assessmentName: z.string(),
                targetPlatform: z.number(),
            }),
        )
        .use(trpcToTelemetry)
        .mutation(async ({ input }) => {
            const assessmentId = uuidv4();
            const response = await AssessmentServiceClient.startAssessment({
                instanceId: assessmentWizardInputs.instanceIdHash,
                assessmentName: input.assessmentName,
                assessmentId,
                logFolderPath: '',
                targetPlatform: input.targetPlatform,
                connectionString: assessmentWizardInputs.connectionString,
                assessmentFolderPath: '',
                dataAssessmentReportPath: '',
            });

            return {
                ...response,
                assessmentId,
            };
        }),
    cancelAssessment: publicProcedure.input(z.string()).mutation(async ({ input }) => {
        return await AssessmentServiceClient.cancelAssessment(input);
    }),

    checkPrerequisite: publicProcedure
        .input(
            z.object({
                connectionString: z.string(),
            }),
        )
        .use(trpcToTelemetry)
        .mutation(async ({ input }) => {
            assessmentWizardInputs.instanceIdHash = await getInstanceIdHash(input.connectionString);
            assessmentWizardInputs.connectionString = input.connectionString;
            const response = await AssessmentServiceClient.checkPrerequisite({
                connectionString: assessmentWizardInputs.connectionString,
                assessmentId: '',
            });

            return response;
        }),

    getAssessmentDetails: publicProcedure
        .input(
            z.object({
                assessmentId: z.string(),
                assessmentName: z.string(),
            }),
        )
        .use(trpcToTelemetry)
        .query(async ({ input }) => {
            const response = await AssessmentServiceClient.getAssessmentDetails({
                assessmentId: input.assessmentId,
                assessmentName: input.assessmentName,
                instanceId: assessmentWizardInputs.instanceIdHash,
                assessmentFolderPath: '',
            });

            return response;
        }),
    getInstanceSummary: publicProcedure
        .input(
            z.object({
                assessmentId: z.string(),
                assessmentName: z.string(),
            }),
        )
        .use(trpcToTelemetry)
        .query(async ({ input }) => {
            const response = await AssessmentServiceClient.getInstanceSummary({
                assessmentId: input.assessmentId,
                assessmentName: input.assessmentName,
                instanceId: assessmentWizardInputs.instanceIdHash,
                assessmentFolderPath: '',
            });

            return response;
        }),
    getCombinedAssessmentReport: publicProcedure
        .input(
            z.object({
                assessmentId: z.string(),
                assessmentName: z.string(),
            }),
        )
        .use(trpcToTelemetry)
        .query(async ({ input }) => {
            const response = await AssessmentServiceClient.getCombinedAssessmentReport({
                assessmentId: input.assessmentId,
                assessmentName: input.assessmentName,
                instanceId: assessmentWizardInputs.instanceIdHash,
                assessmentFolderPath: '',
            });

            return response;
        }),

    getAllAssessments: publicProcedure.use(trpcToTelemetry).query(async () => {
        const response = await AssessmentServiceClient.getAllAssessments({
            instanceId: assessmentWizardInputs.instanceIdHash, //to be removed
            assessmentFolderPath: '',
        });
        return response;
    }),
    deleteAssessment: publicProcedure
        .input(
            z.object({
                assessmentId: z.string(),
                assessmentName: z.string(),
            }),
        )
        .use(trpcToTelemetry)
        .mutation(async ({ input }) => {
            const response = await AssessmentServiceClient.deleteAssessment({
                instanceId: assessmentWizardInputs.instanceIdHash,
                assessmentFolderPath: '',
                assessmentId: input.assessmentId,
                assessmentName: input.assessmentName,
            });

            return response;
        }),
    downloadHtml: publicProcedure
        .input(
            z.object({
                filename: z.string(),
                content: z.string(),
            }),
        )
        .mutation(async ({ input }) => {
            const result = await AssessmentServiceClient.downloadHtmlToDisk(input.filename, input.content);
            return result;
        }),

    showError: publicProcedure
        .input(
            z.object({
                error: z.string(),
            }),
        )
        .mutation(async ({ input }) => {
            const result = await AssessmentServiceClient.showError(input.error);
            return result;
        }),
});
