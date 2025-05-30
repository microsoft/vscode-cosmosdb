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

/**
 * Helper to hash a connection string using sha256.
 */
async function getInstanceIdHash(connectionString: string): Promise<string> {
    const crypto = await import('crypto');
    return crypto.createHash('sha256').update(connectionString).digest('hex');
}

export const assessmentWizardInputs = {
    assessmentId: uuidv4(),
    connectionString: '',
    assessmentName: '',
    instanceIdHash: '',
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
            assessmentWizardInputs.instanceIdHash = await getInstanceIdHash(input.connectionString);

            const response = await AssessmentServiceClient.startAssessment({
                instanceId: assessmentWizardInputs.instanceIdHash,
                assessmentName: input.assessmentName,
                assessmentId: assessmentWizardInputs.assessmentId,
                logFolderPath: '',
                targetPlatform: input.targetPlatform,
                connectionString: input.connectionString,
                assessmentFolderPath: '',
                dataAssessmentReportPath: '',
            });

            return response;
        }),

    getAssessmentDetails: publicProcedure
        .input(
            z.object({
                assessmentName: z.string(),
            }),
        )
        .use(trpcToTelemetry)
        .mutation(async ({ input }) => {
            // Call the getAssessmentDetails procedure from migrationPanelViewRouter
            //const assessmentFolderPath = `${process.env.USERPROFILE || process.env.HOME}\\Desktop`;

            const response = await AssessmentServiceClient.getAssessmentDetails({
                assessmentId: assessmentWizardInputs.assessmentId,
                instanceId: assessmentWizardInputs.instanceIdHash,
                assessmentName: input.assessmentName,
                assessmentFolderPath: '',
            });
            return response;
        }),

    checkPrerequisite: publicProcedure
        .input(
            z.object({
                connectionString: z.string(),
            }),
        )
        .use(trpcToTelemetry)
        .mutation(async ({ input }) => {
            // Store the connectionString for use in other procedures
            assessmentWizardInputs.connectionString = input.connectionString;

            const response = await AssessmentServiceClient.checkPrerequisite({
                connectionString: input.connectionString,
                assessmentId: assessmentWizardInputs.assessmentId,
            });

            return response;
        }),
});

function uuidv4(): string {
    // Generates a RFC4122 version 4 UUID
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

