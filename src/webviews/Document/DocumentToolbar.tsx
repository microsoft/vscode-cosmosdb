/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Toolbar, ToolbarButton, Tooltip } from '@fluentui/react-components';
import { ArrowClockwiseRegular, EditRegular, SaveRegular } from '@fluentui/react-icons';
import { useDocumentState } from './state/DocumentContext';

const ToolbarDividerTransparent = () => {
    return <div style={{ padding: '4px' }} />;
};

export type DocumentToolbarProps = {
    onSave: () => Promise<void>;
    onEdit: () => Promise<void>;
    onRefresh: () => Promise<void>;
};

export const DocumentToolbar = (props: DocumentToolbarProps) => {
    const state = useDocumentState();

    const inProgress = state.isSaving || state.isRefreshing;
    const hasDocumentInDB = state.documentId !== undefined;
    const isReadOnly = state.mode === 'view';
    const isMac = navigator.platform.toLowerCase().includes('mac');

    const onSaveHotkeyTitle = isMac ? 'Cmd+S' : 'Ctrl+S';
    const onEditHotkeyTitle = isMac ? 'Cmd+Shift+E' : 'Ctrl+Shift+E';
    const onRefreshHotkeyTitle = isMac ? 'Cmd+Shift+R' : 'Ctrl+Shift+R';

    return (
        <>
            <Toolbar size={'small'}>
                {!isReadOnly && (
                    <Tooltip
                        content={`Save document to the database (${onSaveHotkeyTitle})`}
                        relationship="description"
                        withArrow
                    >
                        <ToolbarButton
                            onClick={() => void props.onSave()}
                            aria-label="Save document to the database"
                            icon={<SaveRegular />}
                            appearance={'primary'}
                            disabled={inProgress || !state.isDirty || !state.isValid}
                        >
                            Save
                        </ToolbarButton>
                    </Tooltip>
                )}
                {isReadOnly && (
                    <Tooltip
                        content={`Open document for editing (${onEditHotkeyTitle})`}
                        relationship="description"
                        withArrow
                    >
                        <ToolbarButton
                            onClick={() => void props.onEdit()}
                            aria-label="Open document for editing"
                            icon={<EditRegular />}
                            appearance={'primary'}
                        >
                            Edit
                        </ToolbarButton>
                    </Tooltip>
                )}

                <ToolbarDividerTransparent />

                <Tooltip
                    content={`Reload original document from the database (${onRefreshHotkeyTitle})`}
                    relationship="description"
                    withArrow
                >
                    <ToolbarButton
                        onClick={() => void props.onRefresh()}
                        aria-label="Reload original document from the database"
                        icon={<ArrowClockwiseRegular />}
                        disabled={inProgress || !hasDocumentInDB}
                    >
                        Refresh
                    </ToolbarButton>
                </Tooltip>
            </Toolbar>
        </>
    );
};
