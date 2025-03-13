/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Breadcrumb,
    BreadcrumbButton,
    BreadcrumbDivider,
    BreadcrumbItem,
    Button,
    Card,
    CardHeader,
    Input,
    Label
} from '@fluentui/react-components';
import {
    Circle20Filled,
    Circle20Regular, // incomplete step icon (empty circle)
    Record20Filled, // current step icon ("circlish")
} from '@fluentui/react-icons';
import React, { useState, type JSX } from 'react';
import { useConfiguration } from '../../api/webview-client/useConfiguration';
import './assessmentWizardView.scss';
import { type AssessmentWizardViewWebviewConfigurationType } from './assessmentWizardViewController';

export const AssessmentWizardView = (): JSX.Element => {
    useConfiguration<AssessmentWizardViewWebviewConfigurationType>();
    const [migrationLog, setMigrationLog] = useState<string>('');

    // Define wizard steps
    const steps = [
        { key: 'configuration', text: 'Configuration' },
        { key: 'connect', text: 'Connect' },
        { key: 'preview', text: 'Preview' },
        { key: 'migrate', text: 'Migrate' },
    ];
    const [currentStepIndex, setCurrentStepIndex] = useState(0);

    // Allow navigation only to steps before the current one
    const onBreadcrumbClick = (index: number) => {
        if (index < currentStepIndex) {
            setCurrentStepIndex(index);
        }
    };

    // Render step navigation actions above the content
    const renderStepActions = () => {
        switch (currentStepIndex) {
            case 0:
                return (
                    <Button appearance="primary" onClick={() => setCurrentStepIndex(1)}>
                        Next
                    </Button>
                );
            case 1:
                return (
                    <>
                        <Button appearance="secondary" onClick={() => setCurrentStepIndex(0)}>
                            Back
                        </Button>
                        <Button
                            appearance="primary"
                            onClick={() => {
                                setMigrationLog('Connected to MongoDB Cluster successfully.');
                                setCurrentStepIndex(2);
                            }}
                        >
                            Next
                        </Button>
                    </>
                );
            case 2:
                return (
                    <>
                        <Button appearance="secondary" onClick={() => setCurrentStepIndex(1)}>
                            Back
                        </Button>
                        <Button
                            appearance="primary"
                            onClick={() =>
                                setMigrationLog('Migration plan previewed with no errors.')
                            }
                        >
                            Preview Migration Plan
                        </Button>
                        <Button appearance="primary" onClick={() => setCurrentStepIndex(3)}>
                            Next
                        </Button>
                    </>
                );
            case 3:
                return (
                    <>
                        <Button appearance="secondary" onClick={() => setCurrentStepIndex(2)}>
                            Back
                        </Button>
                        <Button
                            appearance="primary"
                            onClick={() =>
                                setMigrationLog('Migrated to MongoDB vCore successfully.')
                            }
                        >
                            Migrate to MongoDB vCore
                        </Button>
                        <Button
                            appearance="primary"
                            onClick={() =>
                                setMigrationLog('Migrated to MongoDB RU on Azure successfully.')
                            }
                        >
                            Migrate to MongoDB RU on Azure
                        </Button>
                    </>
                );
            default:
                return null;
        }
    };

    const HelpButton = ({title }: {title: string }) => (
        <button
            className="help-button"
            style={{
                display: 'inline-flex',
                justifyContent: 'center',
                alignItems: 'center',
                width: '14px',
                height: '14px',
                borderRadius: '50%',
                backgroundColor: 'inherit',
                color: 'inherit',
                fontSize: '8px',
                fontFamily: 'Arial, sans-serif',
                border: '1px solid',
                borderColor: 'inherit',
                cursor: 'pointer',
                padding: 0,
                position: 'relative',
                top: '-2px',
            }}
            title={title}>i</button>
    );

    return (
        <div className="documentView">
            {/* Breadcrumb progress indicator with chevron dividers */}
            <Breadcrumb aria-label="Wizard progress" className="wizardBreadcrumb">
                {steps.map((step, index) => (
                    <React.Fragment key={step.key}>
                        {index > 0 && <BreadcrumbDivider />}
                        <BreadcrumbItem>
                            <BreadcrumbButton
                                onClick={index < currentStepIndex ? () => onBreadcrumbClick(index) : undefined}
                                current={index === currentStepIndex}
                                icon={
                                    index < currentStepIndex ? (
                                        <Circle20Filled />
                                    ) : index === currentStepIndex ? (
                                        <Record20Filled />
                                    ) : (
                                        <Circle20Regular />
                                    )
                                }
                            >
                                {step.text}
                            </BreadcrumbButton>
                        </BreadcrumbItem>
                    </React.Fragment>
                ))}
            </Breadcrumb>

            <h1>{`Step 1: Run a new assessment of your MongoDB server`}</h1>
            <p>{`Before we start migration, we need to start an assessment on your MongoDB server. By default the assessment is run on whole server.`}</p>

            {/* Step content */}
            {currentStepIndex === 0 && (
                <Card>
                    <CardHeader>
                        <strong>Assessment Configuration</strong>
                    </CardHeader>
                    <div className="cardBody" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        <div className="formGroup">
                            <Label htmlFor="assessmentName">
                                Assessment name <span style={{ color: 'red' }}>*</span>
                                <HelpButton title="Enter a unique name for the assessment." />
                            </Label>
                            <br />
                            <Input id="assessmentName" type="text" placeholder="Enter assessment name" />
                        </div>
                        <br />
                        <div className="formGroup">
                            <Label htmlFor="connectionString">
                                Source MongoDB server Connection String <span style={{ color: 'red' }}>*</span>
                                <HelpButton title="URL to the source MongoDB server" />
                            </Label>
                            <br />
                            <Input id="connectionString" type="text" placeholder="Enter connection string" />
                            <Button appearance="secondary">Test Connection</Button>
                        </div>
                        <br />
                        <div className="formGroup">
                            <Label htmlFor="logFolderPath">
                                [Optional] Log folder path
                                <HelpButton title="Path to MongoDB logs" />
                            </Label>
                            <p style={{ fontSize: 'small', color: 'gray' }}>
                                It's highly recomended to provide a log file path when the MongoDB source version is less than 4.4.
                            </p>
                            <a href="https://aka.ms/dmamongo-collect-log-messages" target="_blank" rel="noopener noreferrer" title="Open https://aka.ms/dmamongo-collect-log-messages">How do I get the log folder path?</a>
                            <br />
                            <Input id="logFolderPath" type="text" placeholder="Enter log folder path" />
                            <Button appearance="secondary">Browse</Button>
                        </div>
                        <br />
                        <div className="formGroup">
                            <Label htmlFor="dataAssessmentReportPath">
                                [Optional] Data assessment report path
                                <HelpButton title="Path to data assessment reports" />
                            </Label>
                            <br />
                            <a href="https://aka.ms/MongoMigrationDataAssessment" target="_blank" rel="noopener noreferrer" title="Open https://aka.ms/MongoMigrationDataAssessment">How do I generate the data assessment report?</a>
                            <br />
                            <Input id="dataAssessmentReportPath" type="text" placeholder="Enter data assessment report path" />
                            <Button appearance="secondary">Browse</Button>
                        </div>
                    </div>
                </Card>
            )}

            {currentStepIndex === 1 && (
                <Card>
                    <CardHeader>
                        <strong>Connect to MongoDB Cluster</strong>
                    </CardHeader>
                    <div className="cardBody">
                        <p>
                            Please click the "Connect to MongoDB Cluster" button above to establish a connection.
                        </p>
                    </div>
                </Card>
            )}

            {(currentStepIndex === 2 || currentStepIndex === 3) && (
                <Card className="migrationLogCard">
                    <CardHeader>
                        <strong>Migration Log</strong>
                    </CardHeader>
                    <div className="cardBody">
                        <textarea style={{ width: '100%', height: '150px' }} value={migrationLog} readOnly />
                    </div>
                </Card>
            )}

            {/* Navigation actions placed above the content */}
            <div className="stepActions" style={{ marginBottom: '20px' }}>
                {renderStepActions()}
            </div>
        </div>
    );
};
