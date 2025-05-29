import { Button, Spinner, Text } from '@fluentui/react-components';
import { AssessmentStatus } from "../../../mongoMigration/assessmentService/assessmentServiceInterfaces";
import { useTrpcClient } from '../../api/webview-client/useTrpcClient';
import { fetchAndBuildHtmlReport, fetchAssessmentDetails } from "../migrationPanelView/apiUtils";

export const pollAssessmentStatus = async (
    trpcClient: any,
    assessmentId: string,
    assessmentName: string,
    setAssessmentDetails: (details: any) => void
) => {
    const maxAttempts = 10;
    const delayMs = 4000;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const result = await fetchAssessmentDetails(trpcClient, {
            AssessmentId: assessmentId,
            AssessmentName: assessmentName,
        });

        if (result.AssessmentStatus !== AssessmentStatus.INPROGRESS) {
            setAssessmentDetails(result);
            return;
        }

        await new Promise((res) => setTimeout(res, delayMs));
    }
};


export const AssessmentResults = ({ assessmentDetails }: { assessmentDetails: any }) => {
    const { trpcClient } = useTrpcClient();
    const handleDownload = async () => {
        if (!assessmentDetails.AssessmentName || !assessmentDetails.AssessmentId) return;

        const htmlContent = await fetchAndBuildHtmlReport({
            AssessmentId: assessmentDetails.AssessmentId,
            AssessmentName: assessmentDetails.AssessmentName,
        }, trpcClient);

        await trpcClient.mongoMigration.migrationPanel.downloadHtml.mutate({
            filename: `assessmentreport_${assessmentDetails.AssessmentName}.html`,
            content: htmlContent,
        });
    };
    return (
        <div>
            <h2>Assessment Results</h2>
            {assessmentDetails?.AssessmentStatus === AssessmentStatus.SUCCESS ? (
                <div>
                    <Text>✅ Assessment complete</Text>
                    <Button
                        onClick={handleDownload}
                    >
                        Download Report
                    </Button>
                </div>
            ) : (
                <Spinner label="Assessment in progress... Please wait." />
            )}
        </div>
    );
};

