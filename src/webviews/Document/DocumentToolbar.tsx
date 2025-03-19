/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Toolbar, ToolbarButton, Tooltip } from '@fluentui/react-components';
import { ArrowClockwiseRegular, EditRegular, SaveRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
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

    const isReady = state.isReady;
    const inProgress = state.isSaving || state.isRefreshing;
    const hasDocumentInDB = state.documentId !== '';
    const isReadOnly = isReady && state.mode === 'view'; // If the document is not initialized, it is considered as not state
    const isMac = navigator.platform.toLowerCase().includes('mac');

    const onSaveHotkeyTitle = isMac ? '\u2318 S' : 'Ctrl+S';
    const onEditHotkeyTitle = isMac ? '\u2318 \u21E7 E' : 'Ctrl+Shift+E';
    const onRefreshHotkeyTitle = isMac ? '\u2318 \u21E7 R' : 'Ctrl+Shift+R';

    return (
        <>
            <Toolbar size={'small'}>
                {isReady && !isReadOnly && (
                    <Tooltip
                        content={l10n.t('Save document to the database') + ` (${onSaveHotkeyTitle})`}
                        relationship="description"
                        withArrow
                    >
                        <ToolbarButton
                            onClick={() => void props.onSave()}
                            aria-label={l10n.t('Save document to the database')}
                            icon={<SaveRegular />}
                            appearance={'primary'}
                            disabled={inProgress || !state.isDirty || !state.isValid}
                        >
                            {l10n.t('Save')}
                        </ToolbarButton>
                    </Tooltip>
                )}
                {isReady && isReadOnly && (
                    <Tooltip
                        content={l10n.t('Open document for editing') + ` (${onEditHotkeyTitle})`}
                        relationship="description"
                        withArrow
                    >
                        <ToolbarButton
                            onClick={() => void props.onEdit()}
                            aria-label={l10n.t('Open document for editing')}
                            icon={<EditRegular />}
                            appearance={'primary'}
                        >
                            {l10n.t('Edit')}
                        </ToolbarButton>
                    </Tooltip>
                )}

                <ToolbarDividerTransparent />

                <Tooltip
                    content={l10n.t('Reload original document from the database') + ` (${onRefreshHotkeyTitle})`}
                    relationship="description"
                    withArrow
                >
                    <ToolbarButton
                        onClick={() => void props.onRefresh()}
                        aria-label={l10n.t('Reload original document from the database')}
                        icon={<ArrowClockwiseRegular />}
                        disabled={inProgress || !hasDocumentInDB}
                    >
                        {l10n.t('Refresh')}
                    </ToolbarButton>
                </Tooltip>
            </Toolbar>
        </>
    );
};
