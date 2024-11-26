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

    const isInit = state.isInit;
    const inProgress = state.isSaving || state.isRefreshing;
    const hasDocumentInDB = state.documentId !== '';
    const isReadOnly = isInit && state.mode === 'view'; // If the document is not initialized, it is considered as not state
    const isMac = navigator.platform.toLowerCase().includes('mac');

    const onSaveHotkeyTitle = isMac ? '\u2318 S' : 'Ctrl+S';
    const onEditHotkeyTitle = isMac ? '\u2318 \u21E7 E' : 'Ctrl+Shift+E';
    const onRefreshHotkeyTitle = isMac ? '\u2318 \u21E7 R' : 'Ctrl+Shift+R';

    return (
        <>
            <Toolbar size={'small'}>
                {isInit && !isReadOnly && (
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
                {isInit && isReadOnly && (
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
