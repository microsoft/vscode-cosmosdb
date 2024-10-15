/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Toolbar, ToolbarButton, Tooltip } from '@fluentui/react-components';
import { ArrowClockwiseRegular, SaveRegular } from '@fluentui/react-icons';
import { useDocumentDispatcher, useDocumentState } from './state/DocumentContext';

const ToolbarDividerTransparent = () => {
    return <div style={{ padding: '4px' }} />;
};

export const DocumentToolbar = () => {
    const state = useDocumentState();
    const dispatcher = useDocumentDispatcher();

    const inProgress = state.isSaving || state.isRefreshing;
    const hasDocumentInDB = state.documentId !== undefined;
    const isDirty = state.isDirty;
    const isReadOnly = state.mode === 'view';

    const onSaveRequest = () => {
        // Save document to the database
        void dispatcher.saveDocument(state.currentDocumentContent);
    };

    const onRefreshRequest = () => {
        // Reload original document from the database
        void dispatcher.refreshDocument();
    };

    return (
        <Toolbar size="small">
            <Tooltip content="Save document to the database" relationship="description" withArrow>
                <ToolbarButton
                    onClick={onSaveRequest}
                    aria-label="Save document to the database"
                    icon={<SaveRegular />}
                    appearance={'primary'}
                    disabled={isReadOnly || inProgress || !isDirty || !state.isValid}
                >
                    Save
                </ToolbarButton>
            </Tooltip>

            <ToolbarDividerTransparent />

            <Tooltip content="Reload original document from the database" relationship="description" withArrow>
                <ToolbarButton
                    onClick={onRefreshRequest}
                    aria-label="Reload original document from the database"
                    icon={<ArrowClockwiseRegular />}
                    disabled={inProgress || !hasDocumentInDB}
                >
                    Refresh
                </ToolbarButton>
            </Tooltip>
        </Toolbar>
    );
};
