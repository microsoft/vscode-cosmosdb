/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable @typescript-eslint/no-misused-promises */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import {
    Button,
    Card,
    CardHeader,
    Dropdown,
    Field,
    Input,
    Link,
    Option,
    Text,
    makeStyles
} from '@fluentui/react-components';
import { useState } from 'react';
import { useConfiguration } from '../../api/webview-client/useConfiguration';
import { useTrpcClient } from '../../api/webview-client/useTrpcClient';
import { AssessmentResults, pollAssessmentStatus } from './AssessmentResults';
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

const StepBreadcrumb = ({
    currentStep,
    onStepClick,
}: {
    currentStep: number;
    onStepClick: (step: number) => void;
}) => {
    const styles = useStyles();
    const steps = ['Validation', 'Assessment', 'Report'];

    return (
        <div className={styles.breadcrumb}>
            {steps.map((step, index) => {
                const isActive = index === currentStep;
                const isCompleted = index < currentStep;
                const isClickable = index < currentStep;

                return (
                    <div
                        key={step}
                        className={styles.breadcrumbItem}
                        onClick={() => isClickable && onStepClick(index)}
                        style={{ cursor: isClickable ? 'pointer' : 'default' }}
                    >
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
    value,
    children
}: {
    id: string;
    label: string;
    required?: boolean;
    placeholder?: string;
    helpText?: string;
    link?: { href: string; text: string };
    children?: React.ReactNode;
    value?: string;
    onChange?: (val: string) => void;

}) => (
    <Field label={label} required={required}>
        {link && (
            <Link href={link.href} target="_blank" rel="noopener noreferrer">
                {link.text}
            </Link>
        )}
        {children ? (
            children
        ) : (
            <Input
                id={id}
                placeholder={placeholder}
                style={{ width: '50%' }}
                value={value}
                onChange={(e, data) => onChange?.(data.value)}
            />
        )}
    </Field>
);

export const AssessmentWizardView = ({ onCancel }: { onCancel: () => void }): JSX.Element => {
    useConfiguration<AssessmentWizardViewWebviewConfigurationType>();
    const styles = useStyles();
    const { trpcClient } = useTrpcClient();

    const [currentStep, setCurrentStep] = useState(0);
    const [connectionString, setConnectionString] = useState('');
    const [offering, setOffering] = useState<string>('2');
    const [assessmentName, setAssessmentName] = useState('');
    const [assessmentId, setAssessmentId] = useState<string>(''); // default: empty string

    const [assessmentDetails, setAssessmentDetails] = useState<any>(null);


    const startAssessment = async () => {
        if (!connectionString || !offering || !assessmentName) {
            return;
        }
        try {
            const response = await trpcClient.mongoMigration.assessmentWizard.startAssessment.mutate({
                connectionString,
                assessmentName,
                targetPlatform: parseInt(offering, 10),
            });

            if (!response || !response.assessmentId) {
                return;
            }
            const newAssessmentId = response.assessmentId;
            setAssessmentId(newAssessmentId);
            setCurrentStep(2);
            pollAssessmentStatus(trpcClient, newAssessmentId, assessmentName, setAssessmentDetails);

        } catch (err) {
            console.error("Assessment failed:", err);
            alert("Assessment failed. Please try again.");
        }
    };


    const runValidation = async () => {
        if (!connectionString) {
            return;
        }
        try {
            const response = await trpcClient.mongoMigration.assessmentWizard.checkPrerequisite.mutate({
                connectionString,
            });
            if (response.Body?.IsPreReqSatisfied) {
                setCurrentStep(1);
            } else {
                alert("Validation failed.");
            }
        } catch (err) {
            console.error('Validation error:', err);
            alert('Validation failed. Please try again.');
        }
    };

    return (
        <div>
            <StepBreadcrumb currentStep={currentStep} onStepClick={(step) => setCurrentStep(step)} />

            {(currentStep === 0 || currentStep === 1) && (
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
                                value={assessmentName}
                                onChange={setAssessmentName}
                            />
                            <FormInputRow
                                id="connectionString"
                                label="Source MongoDB server Connection String"
                                placeholder="Enter connection string"
                                required
                                value={connectionString}
                                onChange={setConnectionString}
                            />
                            <FormInputRow id="offering" label="Offering" required>
                                <Dropdown
                                    selectedValue={offering}
                                    onOptionSelect={(_, data) => {
                                        setOffering(data.optionValue ?? '');
                                    }}
                                    style={{ width: '50%', height: '30px' }}
                                >
                                    <Option value="2">vCore</Option>
                                    <Option value="1">RU</Option>
                                </Dropdown>
                            </FormInputRow>

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
                        {currentStep === 0 ? (
                            <Button appearance="primary" onClick={() => void runValidation()}>
                                Run Validation
                            </Button>
                        ) : (
                            <Button appearance="primary" onClick={() => void startAssessment()}>
                                Start Assessment
                            </Button>
                        )}
                        <Button appearance="secondary" onClick={onCancel}>
                            Cancel
                        </Button>
                    </div>
                </>
            )}

            {currentStep === 2 && <AssessmentResults assessmentDetails={assessmentDetails} />}

        </div>
    );
};
