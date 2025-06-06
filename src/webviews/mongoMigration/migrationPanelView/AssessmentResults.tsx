/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { Button, Spinner, Text } from '@fluentui/react-components';
import {
    ArrowDownload24Regular,
    Dismiss24Regular,
} from '@fluentui/react-icons';
import { AssessmentStatus } from "../../../mongoMigration/assessmentService/assessmentServiceInterfaces";
import { useTrpcClient } from '../../api/webview-client/useTrpcClient';
import { fetchAndBuildHtmlReport, fetchAssessmentDetails } from "./Utils/apiUtils";

export const pollAssessmentStatus = async (
    trpcClient: any,
    assessmentId: string,
    assessmentName: string
): Promise<any> => {
    const delayMs = 4000;

    while (true) {
        try {
            const result = await fetchAssessmentDetails(trpcClient, {
                AssessmentId: assessmentId,
                AssessmentName: assessmentName,
            });

            if (result.AssessmentStatus !== undefined && result.AssessmentStatus !== AssessmentStatus.INPROGRESS) {
                return result;
            }

        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : "Download failed.";
            await trpcClient.mongoMigration.migrationPanel.showError.mutate({
                error: errorMessage
            });
        }

        await new Promise((res) => setTimeout(res, delayMs));
    }
};




export const AssessmentResults = ({ assessmentDetails, assessmentId, onCancel }: { assessmentDetails: any, assessmentId: string, onCancel: () => void }) => {
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

    const handleCancel = async () => {
        try {
            await trpcClient.mongoMigration.migrationPanel.cancelAssessment.mutate(assessmentId);
            onCancel()

        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : "Cancellation failed.";
            await trpcClient.mongoMigration.migrationPanel.showError.mutate({
                error: errorMessage
            });
        }
    };
    return (
        <div>
            {assessmentDetails?.AssessmentStatus === AssessmentStatus.SUCCESS ? (
                <>
                    <Text size={400}>✅ Assessment complete</Text>
                    <Button
                        icon={<ArrowDownload24Regular />}
                        appearance="primary"
                        onClick={handleDownload}
                        style={{ width: 'fit-content', alignSelf: 'flex-start' }}
                    >
                        Download Report
                    </Button>
                </>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '1rem' }}>
                    <Spinner label="Assessment in progress... Please wait." />
                    <Button
                        icon={<Dismiss24Regular />}
                        appearance="secondary"
                        onClick={handleCancel}
                        style={{ width: 'fit-content' }}
                    >
                        Cancel Assessment
                    </Button>
                </div>
            )}

            <div
                style={{
                    position: 'fixed',
                    bottom: '20vh',
                    left: '2rem',
                    display: 'flex',
                    gap: '1rem',
                    zIndex: 1000,
                }}
            >
                <Button
                    appearance="secondary"
                    onClick={onCancel}
                >
                    Cancel
                </Button>
                <Button
                    appearance="secondary"
                    onClick={() => {
                        window.dispatchEvent(new CustomEvent('switch-tab', { detail: 'assessments__tab' }));
                    }}
                >
                    View All Assessments
                </Button>
            </div>
        </div>
    );

};

