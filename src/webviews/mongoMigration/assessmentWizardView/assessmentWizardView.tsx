/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable @typescript-eslint/no-misused-promises */

import {
    Button,
    Card,
    CardHeader,
    Field,
    Input,
    Link,
    Text,
    makeStyles
} from '@fluentui/react-components';
import { useState } from 'react';
import { useConfiguration } from '../../api/webview-client/useConfiguration';
import { useTrpcClient } from '../../api/webview-client/useTrpcClient';
import './assessmentWizardView.scss';
import { type AssessmentWizardViewWebviewConfigurationType } from './assessmentWizardViewController';

const useStyles = makeStyles({
    cardBody: {
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
        padding: '16px',
    },
    stepActions: {
        marginTop: '24px',
        display: 'flex',
        gap: '12px',
    },
    breadcrumb: {
        display: 'flex',
        gap: '12px',
        marginBottom: '24px',
        alignItems: 'center',
    },
    breadcrumbItem: {
        display: 'flex',
        alignItems: 'center',
    },
    circle: {
        width: '24px',
        height: '24px',
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 'bold',
    },
    line: {
        width: '40px',
        height: '2px',
        backgroundColor: '#C8C8C8',
        margin: '0 8px',
    },
});

const StepBreadcrumb = ({ currentStep }: { currentStep: number }) => {
    const styles = useStyles();
    const steps = ['Validation', 'Assessment', 'Report'];

    return (
        <div className={styles.breadcrumb}>
            {steps.map((step, index) => {
                const isActive = index === currentStep;
                const isCompleted = index < currentStep;

                return (
                    <div key={step} className={styles.breadcrumbItem}>
                        <div
                            className={styles.circle}
                            style={{
                                backgroundColor: isCompleted ? '#28a745' : isActive ? '#ffc107' : '#e0e0e0',
                                color: isCompleted ? '#fff' : '#000',
                                border: isActive ? '2px solid #ffc107' : 'none',
                            }}
                        >
                            {index + 1}
                        </div>
                        <Text style={{ marginLeft: 8, fontWeight: isActive ? 'bold' : 'normal' }}>{step}</Text>
                        {index < steps.length - 1 && <div className={styles.line}></div>}
                    </div>
                );
            })}
        </div>
    );
};

const FormInputRow = ({
    id,
    label,
    required = false,
    placeholder,
    link,
    onChange,
    value
}: {
    id: string;
    label: string;
    required?: boolean;
    placeholder?: string;
    helpText?: string;
    link?: { href: string; text: string };
    value?: string;
    onChange?: (val: string) => void;
}) => (
    <Field label={label} required={required}>
        {link && (
            <Link href={link.href} target="_blank" rel="noopener noreferrer">
                {link.text}
            </Link>
        )}
        <Input id={id} placeholder={placeholder} style={{ width: '50%' }} value={value}
            onChange={(e, data) => onChange?.(data.value)} />
    </Field>
);

export const AssessmentWizardView = ({ onCancel }: { onCancel: () => void }): JSX.Element => {
    useConfiguration<AssessmentWizardViewWebviewConfigurationType>();
    const styles = useStyles();
    const [currentStep,] = useState(0);
    const [connectionString, setConnectionString] = useState('');
    const { trpcClient } = useTrpcClient();


    // const startAssessment = async () => {
    //     try {
    //         const response = await trpcClient.mongoMigration.assessmentWizard.startAssessment.query();
    //         const parsed = JSON.parse(response) as { success: boolean; data?: unknown; error?: string };
    //         if (parsed.success) {
    //             console.log('Assessment started:', parsed.data);
    //             setCurrentStep(1); // Proceed to step 2
    //         } else {
    //             console.error('Assessment failed:', parsed.error);
    //         }
    //     } catch (e) {
    //         console.error('Error starting assessment:', e);
    //     }
    // };

    const runValidation = async () => {
        if (!connectionString) {
            return;
        }
        console.log("I am connection", connectionString)
        try {
            const response = await trpcClient.mongoMigration.assessmentWizard.checkPrerequisite.mutate({
                connectionString,
            });
            console.log("I am response", response)
        } catch (err) {
            console.error('Failed to delete assessment:', err);
            alert('Failed to delete the assessment. Please try again.');
        }
    };


    return (
        <div>
            <StepBreadcrumb currentStep={currentStep} />

            {currentStep === 0 && (
                <>
                    <h2>Run a new assessment of your MongoDB server</h2>
                    <Text>
                        Before we start migration, we need to assess your MongoDB server.
                        By default, the assessment is run on the whole server.
                    </Text>

                    <Card>
                        <CardHeader>
                            <strong>Assessment Configuration</strong>
                        </CardHeader>
                        <div className={styles.cardBody}>
                            <FormInputRow
                                id="assessmentName"
                                label="Assessment name"
                                placeholder="Enter assessment name"
                                required
                            />
                            <FormInputRow
                                id="connectionString"
                                label="Source MongoDB server Connection String"
                                placeholder="Enter connection string"
                                required
                                value={connectionString}
                                onChange={setConnectionString}
                            />
                            <FormInputRow
                                id="logFolderPath"
                                label="[Optional] Log folder path"
                                placeholder="Enter log folder path"
                                link={{
                                    href: "https://aka.ms/dmamongo-collect-log-messages",
                                    text: "How do I get the log folder path?",
                                }}
                            />
                            <FormInputRow
                                id="dataAssessmentReportPath"
                                label="[Optional] Data assessment report path"
                                placeholder="Enter data assessment report path"
                                link={{
                                    href: "https://aka.ms/MongoMigrationDataAssessment",
                                    text: "How do I generate the data assessment report?",
                                }}
                            />
                        </div>
                    </Card>

                    <div className={styles.stepActions}>
                        <Button appearance="primary" onClick={runValidation}>
                            Run Validation
                        </Button>
                        <Button appearance="secondary" onClick={onCancel}>
                            Cancel
                        </Button>
                    </div>
                </>
            )}

            {currentStep === 1 && (
                <div>
                    <h2>Assessment in Progress</h2>
                    <Text>We are currently assessing your MongoDB server...</Text>
                    {/* Add spinner/progress bar or API polling here */}
                </div>
            )}

            {currentStep === 2 && (
                <div>
                    <h2>Assessment Report</h2>
                    <Text>The report is ready. Display results or link to download.</Text>
                </div>
            )}
        </div>
    );
};
