/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AssessmentMetadata } from '../../../mongoMigration/assessmentService/assessmentServiceInterfaces';
import { buildHtmlReport } from '../ReportBuilder';

export async function fetchAssessmentDetails(
    trpcClient: any,
    item: {
        AssessmentId: string;
        AssessmentName: string;
    },
) {
    const response = await trpcClient.mongoMigration.migrationPanel.getAssessmentDetails.query({
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
export const checkPrerequisite = async (trpcClient: any): Promise<boolean> => {
    try {
        const response = await trpcClient.mongoMigration.migrationPanel.checkPrerequisite.mutate();

        if (response.Body?.IsPreReqSatisfied) {
            return true;
        } else {
            throw new Error(response.Error?.ErrorMessage || 'Validation failed.');
        }
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Validation failed.';
        await trpcClient.mongoMigration.migrationPanel.showError.mutate({
            error: errorMessage,
        });
        return false;
    }
};

export function extractHost(connectionString) {
    if (!connectionString || typeof connectionString !== 'string') {
        return '';
    }

    try {
        const encoded = connectionString;

        const startIndex = encoded.indexOf('://') + 3;
        if (startIndex < 3 || startIndex >= encoded.length) return '';

        let endIndex = encoded.indexOf('/', startIndex);
        if (endIndex === -1) endIndex = encoded.indexOf('?', startIndex);
        if (endIndex === -1) endIndex = encoded.length;

        const hostPart = encoded.substring(startIndex, endIndex);
        const parts = hostPart.split('@');
        return parts.length > 1 ? parts[1] : parts[0];
    } catch {
        return '';
    }
}
