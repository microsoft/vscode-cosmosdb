/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import {
    Text
} from '@fluentui/react-components';
import { useEffect, useState } from 'react';
import { useTrpcClient } from '../../api/webview-client/useTrpcClient';
import { AssessmentResults, pollAssessmentStatus } from './AssessmentResults';
import './AssessmentWizardView.css';
import { checkPrerequisite, fetchAssessments } from './Utils/apiUtils';
import { ValidateConnections } from './ValidateConnection';
import { StartAssessment } from './startAssessment';

const StepBreadcrumb = ({
    currentStep,
    onStepClick,
}: {
    currentStep: number;
    onStepClick: (step: number) => void;
}) => {
    const steps = ['Validation', 'Assessment', 'Report'];

    return (
        <div className="breadcrumb">
            {steps.map((step, index) => {
                const isActive = index === currentStep;
                const isCompleted = index < currentStep;
                const isClickable = index < currentStep;

                return (
                    <div
                        key={step}
                        className="breadcrumbItem"
                        onClick={() => isClickable && onStepClick(index)}
                        style={{ cursor: isClickable ? 'pointer' : 'default' }}
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
    const [offering, setOffering] = useState<string>('');
    const [assessmentName, setAssessmentName] = useState('');
    const [assessmentId, setAssessmentId] = useState<string>('');
    const [errors, setErrors] = useState<{
        offering: string | null;
        assessmentName: string | null;
    }>(() => ({
        offering: null,
        assessmentName: null
    }));
    const [assessmentDetails, setAssessmentDetails] = useState<any>(null);
    const [existingAssessmentNames, setExistingAssessmentNames] = useState<string[]>([]);


    const loadExistingAssessmentNames = async () => {
        const data = await fetchAssessments(trpcClient);
        const names = data.map(a => a.AssessmentName.toLowerCase());
        setExistingAssessmentNames(names);
    };
    useEffect(() => {
        if (currentStep === 1) {
            void loadExistingAssessmentNames();
            if (assessmentName.trim()) validateFields();
        }
    }, [currentStep]);

    const validateFields = () => {
        const newErrors = {
            offering: offering === '' ? 'Offering is required' : null,
            assessmentName: null as string | null
        };

        const name = assessmentName;
        const lower = name.toLowerCase();
        const alphabetCount = (name.match(/[a-zA-Z]/g) || []).length;

        if (name === '') {
            newErrors.assessmentName = 'Assessment name is required';
        } else if (alphabetCount < 3) {
            newErrors.assessmentName = 'Must contain at least 3 alphabets';
        } else if (existingAssessmentNames.includes(lower)) {
            newErrors.assessmentName = 'Assessment name already exists';
        }

        setErrors(newErrors);
        return Object.values(newErrors).every(e => e === null);
    };

    const startAssessment = async () => {
        if (!validateFields()) return;

        setAssessmentDetails(null);
        setAssessmentId('');
        if (!offering || !assessmentName) {
            return;
        }
        try {
            const response = await trpcClient.mongoMigration.migrationPanel.startAssessment.mutate({
                assessmentName,
                targetPlatform: offering,
            });
            if (!response.Body || !response.assessmentId) {
                throw new Error("Assessment could not be started. Missing assessment ID.");
            }
            const newAssessmentId = response.assessmentId;
            setAssessmentId(newAssessmentId);
            setCurrentStep(2);
            const assessmentPollingResult = await pollAssessmentStatus(trpcClient, newAssessmentId, assessmentName);
            setAssessmentDetails(assessmentPollingResult)

        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : "Assessment failed.";
            await trpcClient.mongoMigration.migrationPanel.showError.mutate({
                error: errorMessage
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
            <StepBreadcrumb currentStep={currentStep} onStepClick={(step) => setCurrentStep(step)} />

            {currentStep === 0 && (
                <ValidateConnections
                    onCancel={onCancel}
                    runValidation={runValidation}
                />
            )}
            {currentStep === 1 && (
                <StartAssessment
                    assessmentName={assessmentName}
                    offering={offering}
                    errors={errors}
                    setAssessmentName={setAssessmentName}
                    setOffering={setOffering}
                    onStart={startAssessment}
                    onCancel={onCancel}
                />
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
