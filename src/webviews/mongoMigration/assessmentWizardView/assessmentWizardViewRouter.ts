/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { publicProcedure, router, trpcToTelemetry } from '../../api/extension-server/trpc';

// eslint-disable-next-line import/no-internal-modules
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { AssessmentServiceClient } from '../../../mongoMigration/assessmentService/assessmentServiceClient';
import { type BaseRouterContext } from '../../api/configuration/appRouter';

//import { useTrpcClient } from '../../api/webview-client/useTrpcClient';

/**
 * Information shared during the life time of the webview
 */
export type RouterContext = BaseRouterContext & {
    databaseName: string;
    connectionString: string;
};

export const assessmentWizardView = {
    connectionString: '', // This will be populated from the connectionString input
    assessmentName: '', // This will be populated with the assessment name
};

export const assessmentWizardViewRouter = router({
    getInfo: publicProcedure.use(trpcToTelemetry).query(({ ctx }) => {
        const myCtx = ctx as RouterContext;

        return 'Info from the webview: ' + JSON.stringify(myCtx);
    }),
    getDatabaseName: publicProcedure.use(trpcToTelemetry).query(({ ctx }) => {
        const myCtx = ctx as RouterContext;

        return myCtx.databaseName;
    }),

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

    getAssessmentDetails: publicProcedure.use(trpcToTelemetry).query(async () => {
        // Call the getAssessmentDetails procedure from migrationPanelViewRouter
        const response = await AssessmentServiceClient.getAssessmentDetails({
            assessmentId: '1a1263a9-e76a-407b-97bd-a5f7086c28d9',
            instanceId: '9966ba26e354b9d88cb313a7f19991cc13a3bdb0e7be54cce31dc31a90feba7c',
            assessmentName: 'kjsd',
            assessmentFolderPath: '',
        });
        return JSON.stringify(response);
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
                assessmentId: '1a1263a9-e76a-407b-97bd-a5f7086c28d9',
            });

            return response;
        }),
});
