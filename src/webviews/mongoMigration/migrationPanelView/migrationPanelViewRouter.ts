/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { AssessmentServiceClient } from '../../../mongoMigration/assessmentService/assessmentServiceClient';
import { type BaseRouterContext } from '../../api/configuration/appRouter';
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

            if (response.Error !== null && response.Error !== undefined) {
                // Log telemetry for startAssessment error
                void callWithTelemetryAndErrorHandling<void>(
                    'cosmosDB.mongoMigration.webview.event.migrationPanelView.startAssessmentError',
                    (context) => {
                        context.errorHandling.suppressDisplay = true;
                        context.telemetry.properties.experience = 'mongoMigration';
                        context.telemetry.properties.assessmentName = input.assessmentName;
                        context.telemetry.properties.assessmentId = assessmentId;
                        context.telemetry.properties.error = JSON.stringify(response.Error);
                    }); //TODO: can add connection string?
            }

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

            if (response.Error !== null && response.Error !== undefined) {
                // Log telemetry for getAssessmentDetails error
                void callWithTelemetryAndErrorHandling<void>(
                    'cosmosDB.mongoMigration.webview.event.migrationPanelView.getAssessmentDetailsError',
                    (context) => {
                        context.errorHandling.suppressDisplay = true;
                        context.telemetry.properties.experience = 'mongoMigration';
                        context.telemetry.properties.assessmentName = input.assessmentName;
                        context.telemetry.properties.assessmentId = input.assessmentId;
                        context.telemetry.properties.error = JSON.stringify(response.Error);
                    }); //TODO: can add connection string?
            }

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

            if (response.Error !== null && response.Error !== undefined) {
                // Log telemetry for getInstanceSummary error
                void callWithTelemetryAndErrorHandling<void>(
                    'cosmosDB.mongoMigration.webview.event.migrationPanelView.getInstanceSummaryError',
                    (context) => {
                        context.errorHandling.suppressDisplay = true;
                        context.telemetry.properties.experience = 'mongoMigration';
                        context.telemetry.properties.assessmentName = input.assessmentName;
                        context.telemetry.properties.assessmentId = input.assessmentId;
                        context.telemetry.properties.error = JSON.stringify(response.Error);
                    }); //TODO: can add connection string?
            }

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

            if (response.Error !== null && response.Error !== undefined) {
                // Log telemetry for getCombinedAssessmentReport error
                void callWithTelemetryAndErrorHandling<void>(
                    'cosmosDB.mongoMigration.webview.event.migrationPanelView.getCombinedAssessmentReportError',
                    (context) => {
                        context.errorHandling.suppressDisplay = true;
                        context.telemetry.properties.experience = 'mongoMigration';
                        context.telemetry.properties.assessmentName = input.assessmentName;
                        context.telemetry.properties.assessmentId = input.assessmentId;
                        context.telemetry.properties.error = JSON.stringify(response.Error);
                    }); //TODO: can add connection string?
            }

            return response;
        }),

    getAllAssessments: publicProcedure.use(trpcToTelemetry).query(async () => {
        const response = await AssessmentServiceClient.getAllAssessments({
            instanceId: assessmentWizardInputs.instanceIdHash, //to be removed
            assessmentFolderPath: '',
        });

        if (response.Error !== null && response.Error !== undefined) {
            // Log telemetry for getAllAssessments error
            void callWithTelemetryAndErrorHandling<void>(
                'cosmosDB.mongoMigration.webview.event.migrationPanelView.getAllAssessmentsError',
                (context) => {
                    context.errorHandling.suppressDisplay = true;
                    context.telemetry.properties.experience = 'mongoMigration';
                    context.telemetry.properties.error = JSON.stringify(response.Error);
                }); //TODO: can add connection string?
        }

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

            if (response.valueOf() === false) {
                // Log telemetry for deleteAssessment error
                void callWithTelemetryAndErrorHandling<void>(
                    'cosmosDB.mongoMigration.webview.event.migrationPanelView.deleteAssessmentError',
                    (context) => {
                        context.errorHandling.suppressDisplay = true;
                        context.telemetry.properties.experience = 'mongoMigration';
                        context.telemetry.properties.assessmentName = input.assessmentName;
                        context.telemetry.properties.assessmentId = input.assessmentId;
                        context.telemetry.properties.error = 'Delete assessment failed';
                    }); //TODO: can add connection string?
                //TODO: deleteAssessment response doesn't have error information, so we log a generic error
            }

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
