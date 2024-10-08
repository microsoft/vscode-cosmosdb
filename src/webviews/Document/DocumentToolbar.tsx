/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Toolbar, ToolbarButton, Tooltip } from '@fluentui/react-components';
import { ArrowClockwiseRegular, SaveRegular, TextGrammarCheckmarkRegular } from '@fluentui/react-icons';
import { useDocumentState } from './state/DocumentContext';

const ToolbarDividerTransparent = () => {
    return <div style={{ padding: '4px' }} />;
};

export const DocumentToolbar = () => {
    const state = useDocumentState();

    const isReadOnly = state.mode === 'view';

    const onSaveRequest = () => {
        // Save document to the database
    };

    const onValidateRequest = () => {
        // Check document syntax
    };

    const onRefreshRequest = () => {
        // Reload original document from the database
    };

    return (
        <Toolbar size="small">
            <Tooltip content="Save document to the database" relationship="description" withArrow>
                <ToolbarButton
                    onClick={onSaveRequest}
                    aria-label="Save document to the database"
                    icon={<SaveRegular />}
                    appearance={'primary'}
                    disabled={isReadOnly}
                >
                    Save
                </ToolbarButton>
            </Tooltip>

            <ToolbarDividerTransparent />

            <Tooltip content="Check document syntax" relationship="description" withArrow>
                <ToolbarButton
                    onClick={onValidateRequest}
                    aria-label="Check document syntax"
                    icon={<TextGrammarCheckmarkRegular />}
                    disabled={isReadOnly}
                >
                    Validate
                </ToolbarButton>
            </Tooltip>

            <Tooltip content="Reload original document from the database" relationship="description" withArrow>
                <ToolbarButton
                    onClick={onRefreshRequest}
                    aria-label="Reload original document from the database"
                    icon={<ArrowClockwiseRegular />}
                >
                    Refresh
                </ToolbarButton>
            </Tooltip>
        </Toolbar>
    );
};
