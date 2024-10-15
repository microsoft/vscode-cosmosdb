import { Toolbar, ToolbarButton, Tooltip } from '@fluentui/react-components';
import { ArrowClockwiseRegular, SaveRegular, TextGrammarCheckmarkRegular } from '@fluentui/react-icons';
import { type JSX } from 'react';
import { ToolbarDividerTransparent } from '../../collectionView/components/toolbar/ToolbarDividerTransparent';

interface ToolbarDocumentsProps {
    viewerMode: string;
    onValidateRequest: () => void;
    onRefreshRequest: () => void;
    onSaveRequest: () => void;
}

export const ToolbarDocuments = ({
    viewerMode,
    onValidateRequest,
    onRefreshRequest,
    onSaveRequest,
}: ToolbarDocumentsProps): JSX.Element => {
    return (
        <Toolbar size="small">
            <Tooltip content="Save document to the database" relationship="description" withArrow>
                <ToolbarButton
                    onClick={onSaveRequest}
                    aria-label="Save to the database"
                    icon={<SaveRegular />}
                    appearance={'primary'}
                    disabled={viewerMode === 'view'}
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
                    disabled={true}
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
