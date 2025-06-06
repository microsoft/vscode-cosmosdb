/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable @typescript-eslint/no-misused-promises */
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
    Clock20Regular,
    Delete24Regular,
    DismissCircle24Regular,
    PresenceAvailable10Filled,
    Warning20Regular,
} from '@fluentui/react-icons';
import React, { useEffect, useState } from 'react';
import { AssessmentStatus, type AssessmentMetadata } from '../../../mongoMigration/assessmentService/assessmentServiceInterfaces';
import { useTrpcClient } from '../../api/webview-client/useTrpcClient';
import { fetchAndBuildHtmlReport, fetchAssessments } from './Utils/apiUtils';

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
    const { trpcClient } = useTrpcClient();
    const [assessments, setAssessments] = useState<AssessmentMetadata[]>([]);

    const handleFetchAssessments = async () => {
        const data = await fetchAssessments(trpcClient);
        setAssessments(data);
    };

    useEffect(() => {
        void handleFetchAssessments();
    }, []);
    const renderAssessmentStatus = (item: AssessmentMetadata) => (
        <Stack horizontal verticalAlign="center" tokens={{ childrenGap: 8 }}>
            {(item.AssessmentStatus === AssessmentStatus.SUCCESS) && (
                <PresenceAvailable10Filled style={{ color: '#107C10', width: 16, height: 16 }} />
            )}
            {(item.AssessmentStatus === AssessmentStatus.FAILED ||
                item.AssessmentStatus === AssessmentStatus.ABORTED ||
                item.AssessmentStatus === AssessmentStatus.CANCELLED) && (
                    <DismissCircle24Regular style={{ color: '#A4262C', width: 18, height: 18 }} />
                )}
            {(item.AssessmentStatus === AssessmentStatus.INPROGRESS ||
                item.AssessmentStatus === AssessmentStatus.WAITING) && (
                    <Clock20Regular style={{ color: '#0078D4', width: 16, height: 16 }} />
                )}
            {item.AssessmentStatus === AssessmentStatus.WARNING && (
                <Warning20Regular style={{ color: '#FFD335', width: 16, height: 16 }} />
            )}
            <span>{item.AssessmentStatus}</span>
        </Stack>
    );
    const renderActions = (item?: AssessmentMetadata) => {
        const handleDelete = async () => {
            if (!item) return;
            try {
                await trpcClient.mongoMigration.migrationPanel.deleteAssessment.mutate({
                    assessmentId: item.AssessmentId,
                    assessmentName: item.AssessmentName,
                });

                await handleFetchAssessments();
            } catch (err) {
                console.error('Failed to delete assessment:', err);
                alert('Failed to delete the assessment. Please try again.');
            }
        };

        const handleDownload = async () => {
            if (!item) return;

            const htmlContent = await fetchAndBuildHtmlReport(item, trpcClient);

            await trpcClient.mongoMigration.migrationPanel.downloadHtml.mutate({
                filename: `assessmentreport_${item.AssessmentName}.html`,
                content: htmlContent,
            });
        };

        return (
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
                    onClick={handleDelete}
                >
                    <Delete24Regular />
                </button>
                <button
                    title="Download"
                    aria-label="Download"
                    disabled={item?.AssessmentStatus !== AssessmentStatus.SUCCESS}
                    style={{
                        background: 'transparent',
                        border: 'none',
                        cursor: item?.AssessmentStatus === AssessmentStatus.SUCCESS ? 'pointer' : 'not-allowed',
                        color: item?.AssessmentStatus === AssessmentStatus.SUCCESS ? 'inherit' : '#999',
                        opacity: item?.AssessmentStatus === AssessmentStatus.SUCCESS ? 1 : 0.5,
                    }}
                    onClick={item?.AssessmentStatus === AssessmentStatus.SUCCESS ? handleDownload : undefined}
                >
                    <ArrowDownload24Regular />
                </button>
            </Stack>
        );
    };

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
            onRender: renderAssessmentStatus,
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
            onRender: renderActions,
        },
    ];

    return (
        <Stack tokens={{ childrenGap: 20 }}>
            <DefaultButton
                text={'Refresh'}
                // disabled={loading}
                onRenderIcon={() => <ArrowClockwise24Regular style={{ marginRight: 4 }} />}
                onClick={handleFetchAssessments}
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
