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
    Label,
    Spinner,
    Table,
    TableBody,
    TableCell,
    TableHeader,
    TableHeaderCell,
    TableRow,
} from '@fluentui/react-components';
import {
    Circle20Filled,
    Circle20Regular,
    Record20Filled,
} from '@fluentui/react-icons';
import React, { useEffect, useState } from 'react';
import { useConfiguration } from '../../api/webview-client/useConfiguration';
import { useTrpcClient } from '../../api/webview-client/useTrpcClient';
import './assessmentWizardView.scss';
import { type AssessmentWizardViewWebviewConfigurationType } from './assessmentWizardViewController';

export enum AssessmentStages {
    CollectionsMetadataCollector = "CollectionMetadataCollector",
    FeatureMetadataCollector = "FeatureSupportedCollector",
    InstanceDetailsCollector = "InstanceDetailCollector",
    ShardKeyMetadataCollector = "ShardKeyCollector",
    CollectionOptionsAdvisor = "CollectionOptionsAdvisor",
    FeatureAdvisor = "FeaturesAdvisor",
    IndexAdvisor = "IndexAdvisor",
    InstanceSummaryAdvisor = "InstanceSummaryAdvisor",
    LimitsAndQuotasAdvisor = "LimitsAndQuotasAdvisor",
    ShardKeyAdvisor = "ShardKeyAdvisor",
}

export interface AssessmentProgress {
    assessmentStage: string;
    assessmentStatus: 'SUCCESS' | 'INPROGRESS' | 'FAILED' | 'WARNING';
    stageDuration?: number;
}

export interface AssessmentDetails {
    stages: AssessmentProgress[];
    assessmentStatus?: 'INPROGRESS' | 'SUCCESS' | 'FAILED' | 'CANCELLED'; // Add this if available
}

export const useAssessmentDetails = () => {
    const { trpcClient } = useTrpcClient();
    const [assessmentDetails, setAssessmentDetails] = useState<AssessmentDetails | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchAssessmentDetails = async () => {
            try {
                const response = await trpcClient.mongoMigration.migrationPanel.getAssessmentDetails.query();
                const parsedResponse = JSON.parse(response) as AssessmentDetails;
                setAssessmentDetails(parsedResponse);
            } catch (err) {
                console.error('Failed to fetch assessment details:', err);
                setError('Failed to fetch assessment details.');
            } finally {
                setLoading(false);
            }
        };

        void fetchAssessmentDetails();
    }, []);

    return { assessmentDetails, loading, error };
};

const getStage = (stage: AssessmentStages): string => {
    switch (stage) {
        case AssessmentStages.InstanceDetailsCollector:
            return 'Instance data collection';
        case AssessmentStages.CollectionsMetadataCollector:
            return 'Collections metadata collection';
        case AssessmentStages.FeatureMetadataCollector:
            return 'Feature data collection';
        case AssessmentStages.ShardKeyMetadataCollector:
            return 'Shard key data collection';
        case AssessmentStages.InstanceSummaryAdvisor:
            return 'Instance summary advisor';
        case AssessmentStages.CollectionOptionsAdvisor:
            return 'Collection options advisor';
        case AssessmentStages.FeatureAdvisor:
            return 'Feature advisor';
        case AssessmentStages.IndexAdvisor:
            return 'Index advisor';
        case AssessmentStages.ShardKeyAdvisor:
            return 'Shard key advisor';
        case AssessmentStages.LimitsAndQuotasAdvisor:
            return 'Limits and quotas advisor';
        default:
            return 'Unknown stage';
    }
};

const getDuration = (duration?: number): string => {
    if (!duration) return '--';
    const seconds = Math.floor((duration / 1000) % 60);
    const minutes = Math.floor((duration / (1000 * 60)) % 60);
    const hours = Math.floor((duration / (1000 * 60 * 60)) % 24);
    return `${hours} hr ${minutes} min ${seconds} sec`;
};

export const AssessmentProgressPage = (): JSX.Element => {
    const { assessmentDetails, loading, error } = useAssessmentDetails();

    const getStageStatus = (stage: string): string => {
        const stageDetail = assessmentDetails?.stages.find(
            (s) => s.assessmentStage.toLowerCase() === stage.toLowerCase()
        );
        return stageDetail?.assessmentStatus || 'Waiting';
    };

    const getStageDuration = (stage: string): string => {
        const stageDetail = assessmentDetails?.stages.find(
            (s) => s.assessmentStage.toLowerCase() === stage.toLowerCase()
        );
        return getDuration(stageDetail?.stageDuration);
    };

    if (loading) {
        return (
            <div style={{ textAlign: 'center', marginTop: '20px' }}>
                <Spinner size="large" label="Loading assessment progress..." />
            </div>
        );
    }

    if (error) {
        return (
            <div style={{ textAlign: 'center', marginTop: '20px' }}>
                <p>{error}</p>
            </div>
        );
    }

    if (!assessmentDetails) {
        return (
            <div style={{ textAlign: 'center', marginTop: '20px' }}>
                <p>No assessment progress data available.</p>
            </div>
        );
    }

    return (
        <Card>
            <CardHeader>
                <strong>Assessment Progress</strong>
            </CardHeader>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
                <h2>Assessment in progress...</h2>
                <Spinner size="medium" />
            </div>
            <Table aria-label="Assessment Progress Table">
                <TableHeader>
                    <TableRow>
                        <TableHeaderCell>Assessment steps</TableHeaderCell>
                        <TableHeaderCell>Status</TableHeaderCell>
                        <TableHeaderCell>Time taken</TableHeaderCell>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {Object.values(AssessmentStages).map((stage, index) => (
                        <TableRow key={index}>
                            <TableCell>{getStage(stage)}</TableCell>
                            <TableCell>{getStageStatus(stage)}</TableCell>
                            <TableCell>{getStageDuration(stage)}</TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </Card>
    );
};

export const AssessmentWizardView = ({ onCancel }: { onCancel: () => void }): JSX.Element => {
    // const { trpcClient } = useTrpcClient();
    // const [currentStepIndex, setCurrentStepIndex] = useState(0);

    // const steps = [
    //     { key: 'configuration', text: 'Configuration' },
    //     { key: 'results', text: 'Results' },
    // ];

    // const renderStepActions = () => {
    //     switch (currentStepIndex) {
    //         case 0:
    //             return (
    //                 <>
    //                     <Button appearance="primary"
    //                         onClick={() => {
    //                             //setCurrentStepIndex(-1); // Temporary page index
    //                             trpcClient.mongoMigration.assessmentWizard.startAssessment
    //                                 .query()
    //                                 .then((response: string) => {
    //                                     const parsedResponse = JSON.parse(response) as { success: boolean; data?: unknown; error?: string };
    //                                     if (parsedResponse.success) {
    //                                         console.log('Assessment started successfully:', parsedResponse.data);
    //                                         setCurrentStepIndex(-1);
    //                                     } else {
    //                                         console.error('Failed to start assessment:', parsedResponse.error);
    //                                         setCurrentStepIndex(0); // Return to step 1 on failure
    //                                     }
    //                                 })
    //                                 .catch((error: Error) => {
    //                                     console.error('An error occurred while starting the assessment:', error);
    //                                     setCurrentStepIndex(0); // Return to step 1 on error
    //                                 });
    //                         }}>
    //                         Start assessment
    //                     </Button>
    //                     <Button appearance="secondary" onClick={() => window.close()}>
    //                         Cancel
    //                     </Button>
    //                 </>
    //             );
    //         case 1:
    //             return (
    //                 <>
    //                     <Button appearance="secondary" onClick={() => setCurrentStepIndex(0)}>
    //                         Previous
    //                     </Button>
    //                     <Button appearance="primary" onClick={() => setCurrentStepIndex(2)}>
    //                         Next
    //                     </Button>
    //                     <Button appearance="secondary" onClick={() => window.close()}>
    //                         Cancel
    //                     </Button>
    //                 </>
    //             );
    //         default:
    //             return null;
    //     }
    // };

    // return (
    //     <div className="documentView">
    //         <Breadcrumb aria-label="Wizard progress" className="wizardBreadcrumb">
    //             {steps.map((step, index) => (
    //                 <React.Fragment key={step.key}>
    //                     {index > 0 && <BreadcrumbDivider />}
    //                     <BreadcrumbItem>
    //                         <BreadcrumbButton
    //                             onClick={index < currentStepIndex ? () => setCurrentStepIndex(index) : undefined}
    //                             current={index === currentStepIndex}
    //                             icon={
    //                                 index < currentStepIndex ? (
    //                                     <Circle20Filled />
    //                                 ) : index === currentStepIndex ? (
    //                                     <Record20Filled />
    //                                 ) : (
    //                                     <Circle20Regular />
    //                                 )
    //                             }
    //                         >
    //                             {step.text}
    //                         </BreadcrumbButton>
    //                     </BreadcrumbItem>
    //                 </React.Fragment>
    //             ))}
    //         </Breadcrumb>

    //         {currentStepIndex === -1 && <AssessmentProgressPage />}
    //         {currentStepIndex === 0 && (
    //             <div>
    //                 <h2>Step 1: Run a new assessment of your MongoDB server</h2>
    //                 <p>Before we start migration, we need to start an assessment on your MongoDB server.</p>
    //             </div>
    //         )}
    //         {currentStepIndex === 1 && (
    //             <div>
    //                 <h2>Step 2: View assessment results</h2>
    //                 <p>The assessment report below highlights the incompatibilities that require your attention.</p>
    //             </div>
    //         )}

    //         <div className="stepActions">{renderStepActions()}</div>
    //     </div>
    // );

    useConfiguration<AssessmentWizardViewWebviewConfigurationType>();
    const { trpcClient } = useTrpcClient();

    // Define wizard steps
    const steps = [
        { key: 'configuration', text: 'Configuration' },
        { key: 'results', text: 'Results' },
    ];
    const [currentStepIndex, setCurrentStepIndex] = useState(0);
    const { assessmentDetails, loading } = useAssessmentDetails();

    const isAssessmentInProgress = () => {
        // If we're on step 1 and loading or have no details yet, treat as in progress
        if (currentStepIndex === 1 && (loading || !assessmentDetails)) return true;
        if (!assessmentDetails) return false;
        if (assessmentDetails.assessmentStatus) {
            return assessmentDetails.assessmentStatus === 'INPROGRESS';
        }
        return assessmentDetails.stages.some(
            (s) => s.assessmentStatus === 'INPROGRESS' || s.assessmentStatus === 'WARNING'
        );
    };

    // Allow navigation only to steps before the current one
    // const onBreadcrumbClick = (index: number) => {
    //     if (index < currentStepIndex) {
    //         setCurrentStepIndex(index);
    //     }
    // };

    // Render step navigation actions above the content
    const renderStepActions = () => {
        switch (currentStepIndex) {
            case 0:
                return (
                    <>
                        <Button appearance="primary"
                            onClick={() => {
                                //setCurrentStepIndex(-1); // Temporary page index
                                trpcClient.mongoMigration.assessmentWizard.startAssessment
                                    .query()
                                    .then((response: string) => {
                                        const parsedResponse = JSON.parse(response) as { success: boolean; data?: unknown; error?: string };
                                        if (parsedResponse.success) {
                                            console.log('Assessment started successfully:', parsedResponse.data);
                                            setCurrentStepIndex(1);
                                        } else {
                                            console.error('Failed to start assessment:', parsedResponse.error);
                                            setCurrentStepIndex(0); // Return to step 1 on failure
                                        }
                                    })
                                    .catch((error: Error) => {
                                        console.error('An error occurred while starting the assessment:', error);
                                        setCurrentStepIndex(0); // Return to step 1 on error
                                    });
                            }}>
                            Start assessment
                        </Button>
                        <Button appearance="secondary" onClick={onCancel}>
                            Cancel
                        </Button>
                    </>
                ); // Todo: fix window.close()
            case 1:
                return (
                    <>
                        <Button appearance="secondary" onClick={() => setCurrentStepIndex(0)}>
                            Previous
                        </Button>
                        <Button
                            appearance="primary"
                            onClick={() => {
                                console.log('Assessment results viewed successfully.');
                                setCurrentStepIndex(2);
                            }}
                        >Next
                        </Button>
                        <Button appearance="secondary" onClick={() => window.close()}>
                            Cancel
                        </Button>
                    </>
                );

            default:
                return null;
        }
    };

    const HelpButton = ({ title }: { title: string }) => (
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
                                onClick={index < currentStepIndex ? () => setCurrentStepIndex(index) : undefined}
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

            <p>{'Migrate MongoDB Server Instance - //server'}</p>

            {/* Step 1: Configuration */}
            {currentStepIndex === 0 && (
                <>
                    <h2>{`Step 1: Run a new assessment of your MongoDB server`}</h2>
                    <p>{`Before we start migration, we need to start an assessment on your MongoDB server. By default the assessment is run on whole server.`}</p>
                    <Card style={{ maxHeight: '100%', overflowY: 'auto' }}>
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
                                    It's highly recommended to provide a log file path when the MongoDB source version is less than 4.4.
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
                            </div>
                        </div>
                    </Card>
                </>
            )}

            {/* Step 2: Progress */}
            {/* {currentStepIndex === -1 &&  <AssessmentProgressPage />(
                <div className="assessmentProgress">
                    <h2>{`Assessment in progress...`}</h2>
                    <p>{`We are assessing your MongoDB server instance to check whether you are using any features or syntax that are not supported in Azure Cosmos DB for MongoDB.`}</p>
                    <table className="assessmentTable" style={{ width: '100%', borderCollapse: 'collapse', marginTop: '20px' }}>
                        <thead>                            <tr style={{ backgroundColor: 'inherit', textAlign: 'left' }}>
                                <th style={{ padding: '10px', border: '1px solid #ddd' }}>Assessment steps</th>
                                <th style={{ padding: '10px', border: '1px solid #ddd' }}>Status</th>
                                <th style={{ padding: '10px', border: '1px solid #ddd' }}>Time taken</th>
                            </tr>
                        </thead>
                        <tbody>
                            {Object.values(AssessmentStages).map((stage, index) => (
                                <tr key={index}>
                                    <td style={{ padding: '10px', border: '1px solid #ddd' }}>{getStage(stage)}</td>
                                    <td style={{ padding: '10px', border: '1px solid #ddd' }}>
                                        {getStatus(stage)}
                                    </td>
                                    <td style={{ padding: '10px', border: '1px solid #ddd' }}>
                                        {getStageDuration(stage)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )
            } */}
            {currentStepIndex === 1 && isAssessmentInProgress() && (
                <AssessmentProgressPage />
            )}

            {/* Step 2: Results */}
            {currentStepIndex === 1 && !isAssessmentInProgress() && (
                <>
                    <h2>{`Step 2: View assessment results`}</h2>
                    <p>{`The assessment report below highlights the incompatibilities that require your attention before initiating the migration process.
                        To view instance-wide incompabilities, click on the instance name. To limit the results to database-specific incompatibilities, click on database name.`}</p>
                    <Card style={{ maxHeight: '100%', overflowY: 'auto' }}>
                        <CardHeader>
                            <strong>Assessment results</strong>
                        </CardHeader>
                        <div className="cardBody">
                            <Button
                                appearance="primary"
                                onClick={() => {
                                    // Logic to download the report
                                    console.log('Download report clicked');
                                }}
                                style={{ marginLeft: '10px', backgroundColor: 'green', color: 'white' }}
                            >
                                Download Report
                            </Button>

                            <div style={{ margin: '10px 0', borderBottom: '1px solid lightgrey' }}></div>

                            <div style={{ marginTop: '20px' }}>
                                <details>
                                    <summary style={{ cursor: 'pointer', fontWeight: 'bold' }}>Assessment Summary</summary>
                                    <div style={{ marginTop: '10px', paddingLeft: '20px' }}>
                                        <div style={{ display: 'flex' }}>
                                            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', rowGap: '5px', columnGap: '20px' }}>
                                                <p style={{ margin: 0 }}>Assessment name</p>
                                                <p style={{ margin: 0 }}>: {(document.getElementById('assessmentName') as HTMLInputElement)?.value || 'N/A'}</p>
                                                <p style={{ margin: 0 }}>[Optional] Log folder</p>
                                                <p style={{ margin: 0 }}>: {(document.getElementById('logFolderPath') as HTMLInputElement)?.value || 'N/A'}</p>
                                                <p style={{ margin: 0 }}>Source version</p>
                                                <p style={{ margin: 0 }}>: 3</p>
                                            </div>
                                            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', rowGap: '5px', columnGap: '20px', margin: '0 auto', textAlign: 'left' }}>
                                                <p style={{ margin: 0 }}>Target platform</p>
                                                <p style={{ margin: 0 }}>: vCore</p>
                                                <p style={{ margin: 0 }}>Source Instance Type</p>
                                                <p style={{ margin: 0 }}>: MongoDB</p>
                                                <p style={{ margin: 0 }}>Data Assessment status</p>
                                                <p style={{ margin: 0 }}>: </p>
                                            </div>
                                        </div>
                                    </div>
                                </details>
                            </div>
                        </div>

                        <div style={{ margin: '10px 0', borderBottom: '1px solid lightgrey' }}></div>

                        <div style={{ display: 'flex', gap: '20px', marginTop: '20px' }}>
                            {/* Panel 1 content */}
                            <div style={{ flex: 1, padding: '10px' }}>
                                <Label htmlFor="filterDatabases" style={{ fontSize: 'smaller' }}>Filter Databases</Label>
                                <br />
                                <Input
                                    id="filterDatabases"
                                    type="text"
                                    placeholder="Filter databases by name"
                                    style={{ width: '200px', maxWidth: '200px', marginBottom: '10px' }}
                                    onChange={(e) => {
                                        const filterValue = e.target.value.toLowerCase();
                                        const databaseElements = document.querySelectorAll('.database-item');
                                        databaseElements.forEach((element) => {
                                            const text = element.textContent?.toLowerCase() || '';
                                            (element as HTMLElement).style.display = text.includes(filterValue) ? 'block' : 'none';
                                        });
                                    }}
                                />

                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', alignItems: 'center', gap: '1px' }}>
                                    <p style={{ margin: '0px 0', fontSize: 'small', textAlign: 'left', fontWeight: 'bold' }}>Instance</p>
                                    <p style={{ margin: '0px 0', fontSize: 'small', textAlign: 'right', fontWeight: 'bold' }}>Findings</p>
                                </div>

                                <div style={{ borderBottom: '1px solid lightgrey', margin: '5px 0' }}></div>

                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', alignItems: 'center', gap: '1px' }}>
                                    <p style={{ margin: '0px 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left', fontSize: 'smaller' }}>
                                        {(document.getElementById('connectionString') as HTMLInputElement)?.value || 'N/A'}
                                    </p>
                                    <p style={{ margin: '2px 0', textAlign: 'right', fontSize: 'smaller' }}>
                                        {Math.floor(Math.random() * 100)} {/* todo: Replace with actual findings data */}
                                    </p>
                                </div>

                                <div style={{ margin: '5px 0', display: 'grid', gridTemplateColumns: '1fr 1fr', alignItems: 'center', gap: '1px' }}>
                                    <div style={{ display: 'flex', alignItems: 'left', gap: '5px' }}>
                                        <input
                                            type="checkbox"
                                            id="selectAllCheckbox"
                                            onChange={(e) => {
                                                const isChecked = e.target.checked;
                                                const checkboxes = document.querySelectorAll('input[type="checkbox"]:not(#selectAllCheckbox)');
                                                checkboxes.forEach((checkbox) => {
                                                    (checkbox as HTMLInputElement).checked = isChecked;
                                                });
                                            }}
                                        />
                                        <p style={{ margin: '0px 0', fontSize: 'small', textAlign: 'left', fontWeight: 'bold' }}>Database</p>
                                    </div>
                                    <p style={{ margin: '0px 0', fontSize: 'small', textAlign: 'right', fontWeight: 'bold' }}>Findings</p>
                                </div>

                                <div style={{ borderBottom: '1px solid lightgrey', margin: '5px 0' }}></div>

                                <div style={{ margin: '5px 0', display: 'grid', gridTemplateColumns: '1fr 1fr', alignItems: 'center', gap: '1px' }}>
                                    {/* Simulate fetching databases from the server and displaying them */}
                                    {/* {(() => {
                                        const serverName = (document.getElementById('connectionString') as HTMLInputElement)?.value || '';
                                        if (!serverName) {
                                            return <p style={{ color: 'red' }}>Please provide a valid server name in Step 1.</p>;
                                        }
                                        // Simulate fetching databases from the server
                                        const databases = ['Database 1', 'Database 2', 'Database 3']; // Replace with actual API call
                                        return databases.map((db, index) => (
                                            <div key={index} className="database-item">{db}</div>
                                        ));
                                    })()} */}
                                    {['AlphaDB', 'BetaDB', 'GammaDB', 'DeltaDB', 'EpsilonDB'].map((db, index) => (
                                        <React.Fragment key={index}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                                                <input type="checkbox" id={`checkbox-${index}`} />
                                                <label htmlFor={`checkbox-${index}`} style={{ margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left', fontSize: 'smaller' }}>
                                                    {db}
                                                </label>
                                            </div>
                                            <p style={{ margin: '2px 0', textAlign: 'right', fontSize: 'smaller' }}>
                                                {Math.floor(Math.random() * 100)} {/* todo: Replace with actual findings data */}
                                            </p>
                                        </React.Fragment>
                                    ))}
                                </div>

                            </div>

                            <div style={{ width: '1px', backgroundColor: 'lightgrey' }}></div>

                            {/* Panel 2 content */}
                            <div style={{ flex: 2, padding: '10px' }}>
                                <div style={{ display: 'flex', gap: '20px', alignItems: 'center', flex: '1 2 auto' }}>
                                    <div style={{ flex: 1 }}>
                                        <Label htmlFor="assessmentTypeFilter" style={{ fontSize: 'small' }}>Assessment type</Label>
                                        <select
                                            id="assessmentTypeFilter"
                                            style={{ width: '100%', maxWidth: '100px', marginBottom: '10px', marginLeft: '10px' }}
                                            onChange={(e) => {
                                                const selectedType = e.target.value;
                                                const issueElements = document.querySelectorAll('.issue-item');
                                                issueElements.forEach((element) => {
                                                    const type = element.getAttribute('data-type');
                                                    (element as HTMLElement).style.display = selectedType === 'All' || type === selectedType ? 'block' : 'none';
                                                });
                                            }}
                                        >
                                            <option value="All">All</option>
                                            <option value="Schema">Schema</option>
                                            <option value="Features">Features</option>
                                            <option value="Data">Data</option>
                                        </select>
                                    </div>
                                    <div style={{ flex: 2 }}>
                                        <Label htmlFor="detailsFilter" style={{ fontSize: 'small' }}>Details</Label>
                                    </div>
                                </div>

                                <div style={{ borderBottom: '1px solid lightgrey', margin: '5px 0' }}></div>

                                <div style={{ display: 'flex', gap: '20px' }}>
                                    {/* Left Panel */}
                                    <div style={{ flex: 1 }}>
                                        <div style={{ marginTop: '10px' }}>
                                            <details>
                                                <summary style={{ marginTop: '0px', cursor: 'pointer', fontWeight: 'bold' }}>
                                                    Blocking Issues ({Math.floor(Math.random() * 10)}) {/* Replace with actual data from the report */}
                                                </summary>
                                                <div style={{ marginTop: '0px', paddingLeft: '20px' }}>
                                                    <div className="issue-item" data-type="Schema">
                                                        <p style={{ margin: 0 }}>Schema Issue 1</p>
                                                    </div>
                                                </div>
                                                <div style={{ marginTop: '10px', paddingLeft: '20px' }}></div>
                                            </details>
                                            <br />
                                            <details>
                                                <summary style={{ marginTop: '0px', cursor: 'pointer', fontWeight: 'bold' }}>
                                                    Warning Issues ({Math.floor(Math.random() * 10)}) {/* Replace with actual data from the report */}
                                                </summary>
                                                <div style={{ marginTop: '0px', paddingLeft: '20px' }}>
                                                    <div className="issue-item" data-type="Features">
                                                        <p style={{ margin: 0 }}>Feature Issue 1</p>
                                                    </div>
                                                    <div className="issue-item" data-type="Data">
                                                        <p style={{ margin: 0 }}>Data Issue 1</p>
                                                    </div>
                                                </div>
                                            </details>
                                            <br />
                                            <details>
                                                <summary style={{ marginTop: '0px', cursor: 'pointer', fontWeight: 'bold' }}>
                                                    Informational Issues ({Math.floor(Math.random() * 10)}) {/* Replace with actual data from the report */}
                                                </summary>
                                                <div style={{ marginTop: '0px', paddingLeft: '20px' }}>
                                                    <div className="issue-item" data-type="Features">
                                                        <p style={{ margin: 0 }}>Issue 1</p>
                                                    </div>
                                                    <div className="issue-item" data-type="Data">
                                                        <p style={{ margin: 0 }}>Issue 1</p>
                                                    </div>
                                                </div>
                                            </details>
                                        </div>
                                    </div>

                                    <div style={{ width: '1px', backgroundColor: 'lightgrey', margin: '0 10px', minHeight: '100%' }}></div>

                                    {/* Right Panel */}
                                    <div style={{ flex: 2, paddingLeft: '20px' }}>
                                        <p style={{ fontSize: 'small', color: 'gray' }}>
                                            Details about the selected issue will be displayed here.
                                        </p>
                                    </div>
                                </div>
                            </div>

                        </div>
                    </Card>
                </>
            )
            }

            {/* Navigation actions placed above the content */}
            <div className="stepActions" style={{ marginBottom: '20px' }}>
                {renderStepActions()}
            </div>
        </div >
    );
};
