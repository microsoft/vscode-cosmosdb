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
    InputOnChangeData,
    Link,
    Option,
    Text,
    makeStyles
} from '@fluentui/react-components';
import { Eye24Regular, EyeOff24Regular } from '@fluentui/react-icons';
import { useEffect, useState } from 'react';
import { useConfiguration } from '../../api/webview-client/useConfiguration';
import { useTrpcClient } from '../../api/webview-client/useTrpcClient';
import { fetchAssessments } from '../migrationPanelView/apiUtils';
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
    children,
    validationState,
    validationMessage
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
    validationState?: 'error' | 'warning' | 'success';
    validationMessage?: string;

}) => (
    <Field label={label} required={required} validationState={validationState} validationMessage={validationMessage}>
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
    const [offering, setOffering] = useState<string>('');
    const [assessmentName, setAssessmentName] = useState('');
    const [showConnectionString, setShowConnectionString] = useState(false);
    const [assessmentId, setAssessmentId] = useState<string>('');
    const [errors, setErrors] = useState({
        connectionString: { hasError: false, message: '' },
        offering: { hasError: false, message: '' },
        assessmentName: { hasError: false, message: '' }
    });
    const [assessmentDetails, setAssessmentDetails] = useState<any>(null);
    const [existingAssessmentNames, setExistingAssessmentNames] = useState<string[]>([]);


    useEffect(() => {
        const loadNames = async () => {
            const data = await fetchAssessments(trpcClient);
            const names = data.map(a => a.AssessmentName.toLowerCase());
            setExistingAssessmentNames(names);
        };
        void loadNames();
    }, [trpcClient]);
    console.log("existingAssessmentNames", existingAssessmentNames)

    const validateFields = () => {
        const alphabetCount = (assessmentName.match(/[a-zA-Z]/g) || []).length;
        const lower = assessmentName.toLowerCase();

        const newErrors = {
            connectionString: {
                hasError: connectionString.trim() === '',
                message: connectionString.trim() === '' ? 'Connection string is required' : ''
            },
            offering: {
                hasError: offering.trim() === '',
                message: offering.trim() === '' ? 'Offering is required' : ''
            },
            assessmentName: {
                hasError: false,
                message: ''
            }
        };

        if (assessmentName === '') {
            newErrors.assessmentName = {
                hasError: true,
                message: 'Assessment name is required'
            };
        } else if (alphabetCount < 3) {
            newErrors.assessmentName = {
                hasError: true,
                message: 'Must contain at least 3 alphabets'
            };
        } else if (existingAssessmentNames.includes(lower)) {
            newErrors.assessmentName = {
                hasError: true,
                message: 'Assessment name already exists'
            };
        }

        setErrors(newErrors);

        return !Object.values(newErrors).some(e => e.hasError);
    };


    const startAssessment = async () => {
        if (!validateFields()) return;
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
        if (!validateFields()) return;
        if (!connectionString) {
            return;
        }
        try {
            const response = await trpcClient.mongoMigration.assessmentWizard.checkPrerequisite.mutate({
                connectionString,
            });
            if (response.Body?.IsPreReqSatisfied) {
                setCurrentStep(1);
            }
            else {
                window.acquireVsCodeApi().postMessage({
                    type: 'error',
                    message: 'Assessment failed. Please try again.',
                });
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
                                validationState={errors.assessmentName.hasError ? 'error' : undefined}
                                validationMessage={errors.assessmentName.message}
                            />
                            <FormInputRow
                                id="connectionString"
                                label="Source MongoDB server Connection String"
                                required
                                validationState={errors.connectionString.hasError ? 'error' : undefined}
                                validationMessage={errors.connectionString.message}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <Input
                                        type={showConnectionString ? 'text' : 'password'}
                                        value={connectionString}
                                        placeholder="Enter connection string"
                                        onChange={(_, data: InputOnChangeData) => setConnectionString(data.value)}
                                        style={{ width: '50%' }}
                                    />
                                    <Button
                                        icon={showConnectionString ? <EyeOff24Regular /> : <Eye24Regular />}
                                        appearance="subtle"
                                        onClick={() => setShowConnectionString(prev => !prev)}
                                        style={{ minWidth: 'auto', padding: '4px' }}
                                    />
                                </div>
                            </FormInputRow>
                            <FormInputRow id="offering" label="Offering" required validationState={errors.offering.hasError ? 'error' : undefined}
                                validationMessage={errors.offering.message}>
                                <Dropdown
                                    selectedValue={offering}
                                    onOptionSelect={(_, data) => {
                                        setOffering(data.optionValue ?? '');
                                    }}
                                    style={{ width: '50%', height: '30px' }}
                                >
                                    <Option key="vcore" value="2">vCore</Option>
                                    <Option key="ru" value="1">RU</Option>
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
            )
            }

            {currentStep === 2 && <AssessmentResults assessmentDetails={assessmentDetails} />}

        </div >
    );
};
