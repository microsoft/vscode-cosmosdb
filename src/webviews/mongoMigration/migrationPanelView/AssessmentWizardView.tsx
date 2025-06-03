/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
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
import { useTrpcClient } from '../../api/webview-client/useTrpcClient';
import { AssessmentResults, pollAssessmentStatus } from './AssessmentResults';
import { fetchAssessments } from './Utils/apiUtils';

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
    const styles = useStyles();
    const { trpcClient } = useTrpcClient();

    const [currentStep, setCurrentStep] = useState(0);
    const [connectionString, setConnectionString] = useState('');
    const [offering, setOffering] = useState<string>('');
    const [assessmentName, setAssessmentName] = useState('');
    const [showConnectionString, setShowConnectionString] = useState(false);
    const [assessmentId, setAssessmentId] = useState<string>('');
    const [errors, setErrors] = useState<{
        connectionString: string | null;
        offering: string | null;
        assessmentName: string | null;
    }>(() => ({
        connectionString: null,
        offering: null,
        assessmentName: null
    }));
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

    const validateFields = () => {
        const newErrors = {
            connectionString: connectionString === '' ? 'Connection string is required' : null,
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
        if (!connectionString || !offering || !assessmentName) {
            return;
        }
        try {
            const response = await trpcClient.mongoMigration.migrationPanel.startAssessment.mutate({
                assessmentName,
                targetPlatform: parseInt(offering, 10),
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
        if (!validateFields()) return;
        try {
            const response = await trpcClient.mongoMigration.migrationPanel.checkPrerequisite.mutate({
                connectionString,
            });

            if (response.Body?.IsPreReqSatisfied) {
                setCurrentStep(1);
                return;
            }
            throw new Error(response.Error?.ErrorMessage || "Unknown validation failure.");

        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : "Validation failed.";
            await trpcClient.mongoMigration.migrationPanel.showError.mutate({
                error: errorMessage
            });
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
                                validationState={errors.assessmentName ? 'error' : undefined}
                                validationMessage={errors.assessmentName || undefined}
                            />
                            <FormInputRow
                                id="connectionString"
                                label="Source MongoDB server Connection String"
                                required
                                validationState={errors.connectionString ? 'error' : undefined}
                                validationMessage={errors.connectionString || undefined}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <Input
                                        type={showConnectionString ? 'text' : 'password'}
                                        value={connectionString}
                                        placeholder="Enter connection string"
                                        onChange={(_, data: InputOnChangeData) => setConnectionString(data.value)}
                                        style={{ width: '50%' }}
                                        disabled={currentStep === 1}
                                    />
                                    <Button
                                        icon={showConnectionString ? <EyeOff24Regular /> : <Eye24Regular />}
                                        appearance="subtle"
                                        onClick={() => setShowConnectionString(prev => !prev)}
                                        style={{ minWidth: 'auto', padding: '4px' }}
                                    />
                                </div>
                            </FormInputRow>
                            <FormInputRow
                                id="offering"
                                label="Offering"
                                required
                                validationState={errors.offering ? 'error' : undefined}
                                validationMessage={errors.offering || undefined}>
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
