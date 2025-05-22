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
    mergeStyleSets,
    type IColumn,
} from '@fluentui/react';
import {
    ArrowClockwise24Regular,
    ArrowDownload24Regular,
    Delete24Regular,
    PresenceAvailable10Filled,
} from '@fluentui/react-icons';
import React, { useMemo } from 'react';

initializeIcons();
//need to replace with response
const assessments = [
    {
        key: '1',
        name: 'test',
        status: 'Completed',
        startTime: '5/22/2025, 14:28',
        endTime: '5/22/2025, 14:28',
    },
    {
        key: '1',
        name: 'test',
        status: 'Completed',
        startTime: '5/22/2025, 14:28',
        endTime: '5/22/2025, 14:28',
    },
];
const classNames = mergeStyleSets({
    detailsListWrapperDark: {
        backgroundColor: '#1e1e1e',
        color: '#cccccc',
        borderRadius: 4,
        padding: 8,
    },
    detailsListWrapperLight: {
        backgroundColor: '#ffffff',
        color: '#333333',
        borderRadius: 4,
        padding: 8,
    },
});
const isDark = document.body.classList.contains('vscode-dark');

export const AssessmentsDashboardTab: React.FC = () => {
    const columns: IColumn[] = useMemo(
        () => [
            {
                key: 'name',
                name: 'Assessment name',
                fieldName: 'name',
                minWidth: 120,
                isResizable: true,
            },
            {
                key: 'status',
                name: 'Status',
                fieldName: 'status',
                minWidth: 120,
                isResizable: true,
                onRender: (item) => (
                    <Stack horizontal verticalAlign="center" tokens={{ childrenGap: 8 }}>
                        {item.status === 'Completed' && <PresenceAvailable10Filled style={{ color: '#107C10' }} />}
                        <span>{item.status}</span>
                    </Stack>
                ),
            },
            {
                key: 'startTime',
                name: 'Start time',
                fieldName: 'startTime',
                minWidth: 150,
                isResizable: true,
            },
            {
                key: 'endTime',
                name: 'End time',
                fieldName: 'endTime',
                minWidth: 150,
                isResizable: true,
            },
            {
                key: 'actions',
                name: 'Actions',
                minWidth: 100,
                maxWidth: 120,
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
                                padding: 4,
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
                                padding: 4,
                                color: 'inherit',
                            }}
                            onClick={() => console.log('Download clicked')}
                        >
                            <ArrowDownload24Regular />
                        </button>
                    </Stack>
                ),
            },
        ],
        [],
    );

    return (
        <Stack tokens={{ childrenGap: 20 }}>
            <DefaultButton
                text="Refresh"
                onRenderIcon={() => <ArrowClockwise24Regular style={{ marginRight: 4 }} />}
                styles={{
                    root: {
                        width: '120px',
                        justifyContent: 'flex-start',
                        backgroundColor: isDark ? '#1e1e1e' : '#ffffff',
                        color: isDark ? '#d4d4d4' : '#323130',
                        border: '1px solid #c8c6c4',
                    },
                    rootHovered: {
                        backgroundColor: isDark ? '#2a2d2e' : '#f3f2f1',
                    },
                }}
            />

            <Stack>
                <DetailsList
                    items={assessments}
                    columns={columns}
                    selectionMode={SelectionMode.none}
                    layoutMode={DetailsListLayoutMode.justified}
                    className={isDark ? classNames.detailsListWrapperDark : classNames.detailsListWrapperLight}
                />
            </Stack>
        </Stack>
    );
};
