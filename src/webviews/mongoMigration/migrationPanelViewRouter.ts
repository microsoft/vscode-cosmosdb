/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { AssessmentServiceClient } from '../../mongoMigration/assessmentService/assessmentServiceClient';
import { type BaseRouterContext } from '../api/configuration/appRouter';
import { publicProcedure, router, trpcToTelemetry } from '../api/extension-server/trpc';
import { extractHost } from './Utils/apiUtils';

let instanceIdHash: string | null = null;
const connectionStringVsCode =
    'mongodb+srv://bharath:bharath@m0-cluster-1.v5ezy.mongodb.net/?retryWrites=true&w=majority&connectTimeoutMS=10000';
//to be received by Tomasz

let hostName = extractHost(connectionStringVsCode);
console.log(hostName);

async function getInstanceIdHash(hostName: string): Promise<string> {
    const crypto = await import('crypto');
    return crypto.createHash('sha256').update(hostName).digest('hex');
}

async function getInstanceId(): Promise<string> {
    if (!instanceIdHash) {
        instanceIdHash = await getInstanceIdHash(hostName);
    }
    return instanceIdHash;
}

export type RouterContext = BaseRouterContext & {};
export const migrationPanelViewRouter = router({
    startAssessment: publicProcedure
        .input(
            z.object({
                assessmentName: z.string(),
                targetPlatform: z.number(),
                logFolderPath: z.string(),
                dataAssessmentReportPath: z.string(),
            }),
        )
        .use(trpcToTelemetry)
        .mutation(async ({ input }) => {
            console.log('I am targetPlatform', input.targetPlatform);
            const assessmentId = uuidv4();
            const response = await AssessmentServiceClient.startAssessment({
                instanceId: await getInstanceId(),
                assessmentName: input.assessmentName,
                assessmentId,
                logFolderPath: input.logFolderPath,
                targetPlatform: input.targetPlatform,
                connectionString: connectionStringVsCode,
                assessmentFolderPath: '',
                dataAssessmentReportPath: input.dataAssessmentReportPath,
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
                    },
                ); //TODO: can add connection string?
            }

            return {
                ...response,
                assessmentId,
            };
        }),
    cancelAssessment: publicProcedure.input(z.string()).mutation(async ({ input }) => {
        return await AssessmentServiceClient.cancelAssessment(input);
    }),

    checkPrerequisite: publicProcedure.use(trpcToTelemetry).mutation(async () => {
        const response = await AssessmentServiceClient.checkPrerequisite({
            connectionString: connectionStringVsCode,
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
                instanceId: await getInstanceId(),
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
                    },
                ); //TODO: can add connection string?
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
                instanceId: await getInstanceId(),
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
                    },
                ); //TODO: can add connection string?
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
                instanceId: await getInstanceId(),
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
                    },
                ); //TODO: can add connection string?
            }

            return response;
        }),

    getAllAssessments: publicProcedure.use(trpcToTelemetry).query(async () => {
        const response = await AssessmentServiceClient.getAllAssessments({
            instanceId: await getInstanceId(),
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
                },
            ); //TODO: can add connection string?
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
                instanceId: await getInstanceId(),
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
                    },
                ); //TODO: can add connection string?
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
