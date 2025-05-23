/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    DefaultButton,
    DetailsList,
    DetailsListLayoutMode,
    SelectionMode,
    Stack,
    initializeIcons,
    loadTheme,
    type IColumn,
} from '@fluentui/react';
import {
    ArrowClockwise24Regular,
    ArrowDownload24Regular,
    Delete24Regular,
    DismissCircle24Regular,
    PresenceAvailable10Filled,
} from '@fluentui/react-icons';
import React, { useEffect, useState } from 'react';
import {
    AssessmentMetadata,
    GetAllAssessmentsResponse,
} from '../../../mongoMigration/assessmentService/assessmentServiceInterfaces';
import { useTrpcClient } from '../../api/webview-client/useTrpcClient';

initializeIcons();

const darkTheme = {
    palette: {
        themePrimary: '#ffffff',
        neutralLighterAlt: '#1e1e1e',
        neutralLighter: '#252526',
        neutralLight: '#2a2d2e',
        neutralQuaternaryAlt: '#3c3c3c',
        neutralQuaternary: '#3c3c3c',
        neutralTertiary: '#cccccc',
        neutralSecondary: '#d4d4d4',
        neutralPrimaryAlt: '#f3f3f3',
        neutralPrimary: '#ffffff',
        neutralDark: '#f8f8f8',
        black: '#f8f8f8',
        white: '#1e1e1e',
    },
};

if (document.body.classList.contains('vscode-dark')) {
    loadTheme(darkTheme);
}

export const AssessmentsDashboardTab: React.FC = () => {
    const [assessments, setAssessments] = useState<AssessmentMetadata[]>([]);
    const [loading, setLoading] = useState(false);
    const { trpcClient } = useTrpcClient();

    const fetchAssessments = async () => {
        setLoading(true);
        try {
            const response = await trpcClient.mongoMigration.migrationPanel.getAllAssessments.query();
            const rawData = (response as unknown as GetAllAssessmentsResponse).Body;
            const formatted: AssessmentMetadata[] = rawData.map((a) => ({
                AssessmentId: a.AssessmentId,
                AssessmentName: a.AssessmentName,
                AssessmentStatus: a.AssessmentStatus,
                StartTime: a.StartTime,
                EndTime: a.EndTime,
                TargetPlatform: a.TargetPlatform,
            }));

            setAssessments(formatted);
        } catch (err) {
            console.error('Failed to fetch assessments', err);
        }
        setLoading(false);
    };

    useEffect(() => {
        fetchAssessments();
    }, []);

    const columns: IColumn[] = [
        {
            key: 'name',
            name: 'Assessment name',
            fieldName: 'AssessmentName',
            minWidth: 120,
            isResizable: true,
        },
        {
            key: 'status',
            name: 'Status',
            fieldName: 'AssessmentStatus',
            minWidth: 120,
            isResizable: true,
            onRender: (item) => (
                <Stack horizontal verticalAlign="center" tokens={{ childrenGap: 8 }}>
                    {item.AssessmentStatus === 'Successful' && (
                        <PresenceAvailable10Filled style={{ color: '#107C10', width: 16, height: 16 }} />
                    )}
                    {item.AssessmentStatus === 'Cancelled' && (
                        <DismissCircle24Regular style={{ color: '#A4262C', width: 18, height: 18 }} />
                    )}
                    <span>{item.AssessmentStatus}</span>
                </Stack>
            ),
        },
        {
            key: 'startTime',
            name: 'Start time',
            fieldName: 'StartTime',
            minWidth: 150,
            isResizable: true,
        },
        {
            key: 'endTime',
            name: 'End time',
            fieldName: 'EndTime',
            minWidth: 150,
            isResizable: true,
        },
        {
            key: 'actions',
            name: 'Actions',
            minWidth: 120,
            isResizable: false,
            onRender: () => (
                <Stack horizontal tokens={{ childrenGap: 8 }}>
                    <button
                        title="Delete"
                        aria-label="Delete"
                        style={{
                            background: 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            color: 'inherit',
                        }}
                        onClick={() => console.log('Delete clicked')}
                    >
                        <Delete24Regular />
                    </button>
                    <button
                        title="Download"
                        aria-label="Download"
                        style={{
                            background: 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            color: 'inherit',
                        }}
                        onClick={() => console.log('Download clicked')}
                    >
                        <ArrowDownload24Regular />
                    </button>
                </Stack>
            ),
        },
    ];

    return (
        <Stack tokens={{ childrenGap: 20 }}>
            <DefaultButton
                text={loading ? 'Refreshing...' : 'Refresh'}
                disabled={loading}
                onRenderIcon={() => <ArrowClockwise24Regular style={{ marginRight: 4 }} />}
                onClick={fetchAssessments}
                styles={{
                    root: {
                        width: '120px',
                        justifyContent: 'flex-start',
                        backgroundColor: 'inherit',
                        color: 'inherit',
                        border: '1px solid #c8c6c4',
                    },
                    rootHovered: {
                        backgroundColor: 'inherit',
                    },
                }}
            />
            <DetailsList
                items={assessments}
                columns={columns}
                selectionMode={SelectionMode.none}
                layoutMode={DetailsListLayoutMode.justified}
            />
        </Stack>
    );
};
