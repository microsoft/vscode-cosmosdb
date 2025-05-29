import { buildHtmlReport } from './reportBuilder';

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
