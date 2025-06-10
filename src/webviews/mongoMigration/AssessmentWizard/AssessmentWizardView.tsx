/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import {
    Text
} from '@fluentui/react-components';
import { useState } from 'react';
import { useTrpcClient } from '../../api/webview-client/useTrpcClient';
import { StartAssessment } from '../startAssessment';
import { checkPrerequisite } from '../Utils/apiUtils';
import { AssessmentResults, pollAssessmentStatus } from './AssessmentResults';
import './AssessmentWizardView.css';
import { ValidateConnections } from './ValidateConnection';

const StepBreadcrumb = ({
    currentStep,
}: {
    currentStep: number;
}) => {
    const steps = ['Validation', 'Assessment', 'Report'];

    return (
        <div className="breadcrumb">
            {steps.map((step, index) => {
                const isActive = index === currentStep;
                const isCompleted = index < currentStep;
                return (
                    <div
                        key={step}
                        className="breadcrumbItem"
                    >
                        <div
                            className="circle"
                            style={{
                                backgroundColor: isCompleted ? '#28a745' : isActive ? '#ffc107' : '#e0e0e0',
                                color: isCompleted ? '#fff' : '#000',
                                border: isActive ? '2px solid #ffc107' : 'none',
                            }}
                        >
                            {index + 1}
                        </div>
                        <Text style={{ marginLeft: 8, fontWeight: isActive ? 'bold' : 'normal' }}>{step}</Text>
                        {index < steps.length - 1 && <div className="line"></div>}
                    </div>
                );
            })}
        </div>
    );
};

export const AssessmentWizardView = ({ onCancel }: { onCancel: () => void }): JSX.Element => {
    const { trpcClient } = useTrpcClient();

    const [currentStep, setCurrentStep] = useState(0);
    const [assessmentId, setAssessmentId] = useState<string>('');
    const [assessmentDetails, setAssessmentDetails] = useState<any>(null);

    const startAssessment = async ({
        assessmentName,
        offering,
        logFolderPath,
        dataAssessmentReportPath,
    }: {
        assessmentName: string;
        offering: string;
        logFolderPath?: string;
        dataAssessmentReportPath?: string;
    }) => {

        setAssessmentDetails(null);
        setAssessmentId('');

        try {
            const response = await trpcClient.mongoMigration.migrationPanel.startAssessment.mutate({
                assessmentName,
                targetPlatform: parseInt(offering, 10),
                logFolderPath: logFolderPath ?? '',
                dataAssessmentReportPath: dataAssessmentReportPath ?? '',
            });

            if (!response.Body || !response.assessmentId) {
                throw new Error('Assessment could not be started. Missing ID.');
            }

            const newAssessmentId = response.assessmentId;
            setAssessmentId(newAssessmentId);
            setCurrentStep(2);

            const assessmentPollingResult = await pollAssessmentStatus(
                trpcClient,
                newAssessmentId,
                assessmentName
            );
            console.log("I am result polling", assessmentPollingResult)
            setAssessmentDetails(assessmentPollingResult);

        } catch (err) {
            const errorMessage =
                err instanceof Error ? err.message : 'Assessment failed.';
            await trpcClient.mongoMigration.migrationPanel.showError.mutate({
                error: errorMessage,
            });
        }
    };

    const runValidation = async () => {
        const isValid = await checkPrerequisite(trpcClient);
        if (isValid) {
            setCurrentStep(1);
        }
    };
    return (
        <div>
            <StepBreadcrumb currentStep={currentStep} />

            {currentStep === 0 && (
                <ValidateConnections
                    onCancel={onCancel}
                    runValidation={runValidation}
                />
            )}
            {currentStep === 1 && (
                <StartAssessment onStart={startAssessment} onCancel={onCancel} />
            )}

            {currentStep === 2 && (
                <AssessmentResults
                    assessmentDetails={assessmentDetails}
                    assessmentId={assessmentId}
                    onCancel={onCancel}
                />
            )}

        </div >
    );
};
