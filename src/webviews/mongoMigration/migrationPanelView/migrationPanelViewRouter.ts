/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { publicProcedure, router, trpcToTelemetry } from '../../api/extension-server/trpc';

// eslint-disable-next-line import/no-internal-modules
import { z } from 'zod';
import { getThemeAgnosticIconPath } from '../../../constants';
import { AssessmentServiceClient } from '../../../mongoMigration/assessmentService/assessmentServiceClient';
import { type BaseRouterContext } from '../../api/configuration/appRouter';

/**
 * Information shared during the life time of the webview
 */
export type RouterContext = BaseRouterContext & {
};

export const migrationPanelViewRouter = router({
    getAssessmentDetails: publicProcedure
        .use(trpcToTelemetry)
        .query(async () => {
            const response = await AssessmentServiceClient.getAssessmentDetails({
                "assessmentId": "1a1263a9-e76a-407b-97bd-a5f7086c28d9",
                "instanceId": "9966ba26e354b9d88cb313a7f19991cc13a3bdb0e7be54cce31dc31a90feba7c",
                "assessmentName": "kjsd",
                "assessmentFolderPath": ""
            });
            return 'Assessment data returned ' + JSON.stringify(response);
        }),
    getWaterMarkIconPath: publicProcedure.use(trpcToTelemetry).query(() => {
        return getThemeAgnosticIconPath('mongoMigrationWatermark.svg').light;
    }),
    getAllAssessments: publicProcedure
        .use(trpcToTelemetry)
        .query(async () => {
            const response = await AssessmentServiceClient.getAllAssessments({
            instanceId: "9966ba26e354b9d88cb313a7f19991cc13a3bdb0e7be54cce31dc31a90feba7c",
            assessmentFolderPath: "",
            });
            return response;
        }),
    deleteAssessment: publicProcedure
        .input(z.object({
            assessmentId: z.string(),
            assessmentName: z.string()
        }))
        .use(trpcToTelemetry)
        .mutation(async ({ input }) => {
            const response = await AssessmentServiceClient.deleteAssessment({
            instanceId: '9966ba26e354b9d88cb313a7f19991cc13a3bdb0e7be54cce31dc31a90feba7c',
            assessmentFolderPath: "",
            assessmentId: input.assessmentId,
            assessmentName: input.assessmentName,
            });

            return response;
    }),


});


