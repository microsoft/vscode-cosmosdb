/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AssessmentMetadata } from '../../../../mongoMigration/assessmentService/assessmentServiceInterfaces';
import { buildHtmlReport } from '../reportBuilder';

export async function fetchAssessmentDetails(
    trpcClient: any,
    item: {
        AssessmentId: string;
        AssessmentName: string;
    },
) {
    const response = await trpcClient.mongoMigration.migrationPanel.getAssessmentDetails2.query({
        assessmentId: item.AssessmentId,
        assessmentName: item.AssessmentName,
    });
    return response.Body;
}

export async function fetchInstanceSummary(
    trpcClient: any,
    item: {
        AssessmentId: string;
        AssessmentName: string;
    },
) {
    const response = await trpcClient.mongoMigration.migrationPanel.getInstanceSummary.query({
        assessmentId: item.AssessmentId,
        assessmentName: item.AssessmentName,
    });
    return response.Body;
}

export async function fetchCombinedAssessmentReport(
    trpcClient: any,
    item: {
        AssessmentId: string;
        AssessmentName: string;
    },
) {
    const response = await trpcClient.mongoMigration.migrationPanel.getCombinedAssessmentReport.query({
        assessmentId: item.AssessmentId,
        assessmentName: item.AssessmentName,
    });
    return response.Body;
}

export async function fetchAndBuildHtmlReport(
    item: {
        AssessmentId: string;
        AssessmentName: string;
    },
    trpcClient: any,
) {
    const [assessmentDetails, instanceSummary, combinedAssessmentReportData] = await Promise.all([
        fetchAssessmentDetails(trpcClient, item),
        fetchInstanceSummary(trpcClient, item),
        fetchCombinedAssessmentReport(trpcClient, item),
    ]);

    return buildHtmlReport({
        assessmentDetails,
        instanceSummary,
        combinedAssessmentReportData,
    });
}
const formatDate = (dateString: string) =>
    new Date(dateString).toLocaleString('en-US', {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    });

export const fetchAssessments = async (trpcClient: any): Promise<AssessmentMetadata[]> => {
    try {
        const response = await trpcClient.mongoMigration.migrationPanel.getAllAssessments.query();
        const rawData = response.Body;

        const formatted: AssessmentMetadata[] = rawData.map((a) => ({
            ...a,
            StartTime: formatDate(a.StartTime),
            EndTime: formatDate(a.EndTime),
        }));

        return formatted;
    } catch (err) {
        console.error('Failed to fetch assessments', err);
        return [];
    }
};
