/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Toolbar, ToolbarButton, Tooltip } from '@fluentui/react-components';
import { ArrowClockwiseRegular, SaveRegular, TextGrammarCheckmarkRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type JSX } from 'react';
import { ToolbarDividerTransparent } from '../../collectionView/components/toolbar/ToolbarDividerTransparent';

interface ToolbarDocumentsProps {
    disableSaveButton: boolean;
    onValidateRequest: () => void;
    onRefreshRequest: () => void;
    onSaveRequest: () => void;
}

export const ToolbarDocuments = ({
    disableSaveButton,
    onValidateRequest,
    onRefreshRequest,
    onSaveRequest,
}: ToolbarDocumentsProps): JSX.Element => {
    return (
        <Toolbar size="small">
            <Tooltip content={l10n.t('Save document to the database')} relationship="description" withArrow>
                <ToolbarButton
                    onClick={onSaveRequest}
                    aria-label={l10n.t('Save to the database')}
                    icon={<SaveRegular />}
                    appearance={'primary'}
                    disabled={disableSaveButton}
                >
                    {l10n.t('Save')}
                </ToolbarButton>
            </Tooltip>

            <ToolbarDividerTransparent />

            <Tooltip content={l10n.t('Check document syntax')} relationship="description" withArrow>
                <ToolbarButton
                    onClick={onValidateRequest}
                    aria-label={l10n.t('Check document syntax')}
                    icon={<TextGrammarCheckmarkRegular />}
                    disabled={true}
                >
                    {l10n.t('Validate')}
                </ToolbarButton>
            </Tooltip>

            <Tooltip
                content={l10n.t('Reload original document from the database')}
                relationship="description"
                withArrow
            >
                <ToolbarButton
                    onClick={onRefreshRequest}
                    aria-label={l10n.t('Reload original document from the database')}
                    icon={<ArrowClockwiseRegular />}
                >
                    {l10n.t('Refresh')}
                </ToolbarButton>
            </Tooltip>
        </Toolbar>
    );
};
