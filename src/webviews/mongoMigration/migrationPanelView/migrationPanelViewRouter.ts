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

export type RouterContext = BaseRouterContext & {};
export const migrationPanelViewRouter = router({
    startAssessment: publicProcedure
        .input(
            z.object({
                connectionString: z.string(),
                assessmentName: z.string(),
                targetPlatform: z.number(),
            }),
        )
        .use(trpcToTelemetry)
        .mutation(async ({ input }) => {
            const assessmentId = uuidv4();
            const response = await AssessmentServiceClient.startAssessment({
                instanceId: '9966ba26e354b9d88cb313a7f19991cc13a3bdb0e7be54cce31dc31a90feba7c',
                assessmentName: input.assessmentName,
                assessmentId,
                logFolderPath: '',
                targetPlatform: input.targetPlatform,
                connectionString: input.connectionString,
                assessmentFolderPath: '',
                dataAssessmentReportPath: '',
            });

            return {
                ...response,
                assessmentId,
            };
        }),
    cancelAssessment: publicProcedure
        .input(z.string()) // ✅ Expect just a string
        .mutation(async ({ input }) => {
            return await AssessmentServiceClient.cancelAssessment(input); // ✅ input is already a string
        }),

    checkPrerequisite: publicProcedure
        .input(
            z.object({
                connectionString: z.string(),
            }),
        )
        .use(trpcToTelemetry)
        .mutation(async ({ input }) => {
            const response = await AssessmentServiceClient.checkPrerequisite({
                connectionString: input.connectionString,
                assessmentId: '',
            });

            return response;
        }),

    getAssessmentDetails: publicProcedure.use(trpcToTelemetry).query(async () => {
        const response = await AssessmentServiceClient.getAssessmentDetails({
            assessmentId: '1a1263a9-e76a-407b-97bd-a5f7086c28d9',
            instanceId: '9966ba26e354b9d88cb313a7f19991cc13a3bdb0e7be54cce31dc31a90feba7c',
            assessmentName: 'kjsd',
            assessmentFolderPath: '',
        });
        return 'Assessment data returned ' + JSON.stringify(response);
    }),
    getAssessmentDetails2: publicProcedure //usethis
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
                instanceId: '9966ba26e354b9d88cb313a7f19991cc13a3bdb0e7be54cce31dc31a90feba7c',
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
                instanceId: '9966ba26e354b9d88cb313a7f19991cc13a3bdb0e7be54cce31dc31a90feba7c',
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
                instanceId: '9966ba26e354b9d88cb313a7f19991cc13a3bdb0e7be54cce31dc31a90feba7c',
                assessmentFolderPath: '',
            });

            return response;
        }),

    getAllAssessments: publicProcedure.use(trpcToTelemetry).query(async () => {
        const response = await AssessmentServiceClient.getAllAssessments({
            instanceId: '9966ba26e354b9d88cb313a7f19991cc13a3bdb0e7be54cce31dc31a90feba7c',
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
                instanceId: '9966ba26e354b9d88cb313a7f19991cc13a3bdb0e7be54cce31dc31a90feba7c',
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
