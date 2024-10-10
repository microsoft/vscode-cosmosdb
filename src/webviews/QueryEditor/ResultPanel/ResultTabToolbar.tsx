/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    makeStyles,
    Toolbar,
    ToolbarButton,
    ToolbarDivider,
    ToolbarRadioButton,
    Tooltip,
    type ToolbarProps,
} from '@fluentui/react-components';
import {
    DocumentAddRegular,
    DocumentArrowDownRegular,
    DocumentDismissRegular,
    DocumentEditRegular,
    EditRegular,
    EyeRegular,
} from '@fluentui/react-icons';
import { extractPartitionKey } from '../../utils';
import { useQueryEditorDispatcher, useQueryEditorState } from '../state/QueryEditorContext';
import { type EditMode, type TableViewMode } from '../state/QueryEditorState';

const useStyles = makeStyles({
    viewModeButton: {
        maxWidth: '40px',
        minWidth: '40px',
    },
    editModeButton: {
        maxWidth: '60px',
        minWidth: '60px',
    },
    toolbar: {
        padding: '0 0px',
    },
});

const ToolbarDividerTransparent = () => {
    return <div style={{ padding: '18px' }} />;
};

export const ResultTabToolbar = () => {
    const styles = useStyles();

    const state = useQueryEditorState();
    const dispatcher = useQueryEditorDispatcher();

    const isEditMode = state.editMode === 'Edit';
    const isTableViewMode = state.tableViewMode === 'Table';

    const checkedValues = {
        tableViewMode: [state.tableViewMode],
        editMode: [state.editMode],
    };

    const onCheckedValueChange: ToolbarProps['onCheckedValueChange'] = (_event, { name, checkedItems }) => {
        if (name === 'tableViewMode') {
            dispatcher.setTableViewMode(checkedItems[0] as TableViewMode);
        } else if (name === 'editMode') {
            dispatcher.setEditMode(checkedItems[0] as EditMode);
        }
    };

    const onNewDocumentClick = () => {
        // eslint-disable-next-line no-console
        console.log('New document clicked');
    };
    const onViewDocumentClick = () => {
        const selectedDocuments = state.selectedRows
            .map((rowIndex) => {
                const document = state.currentQueryResult?.documents[rowIndex];
                return document
                    ? {
                          id: document.id,
                          partitionKey: state.partitionKey
                              ? extractPartitionKey(document, state.partitionKey)
                              : undefined,
                          _rid: document._rid,
                      }
                    : undefined;
            })
            .filter((document) => document !== undefined);

        void dispatcher.openDocuments('view', selectedDocuments);
    };
    const onEditDocumentClick = () => {
        // eslint-disable-next-line no-console
        console.log('Edit document clicked');
    };
    const onDeleteDocumentClick = () => {
        // eslint-disable-next-line no-console
        console.log('Delete document clicked');
    };

    return (
        <Toolbar
            aria-label="Table view toolbar"
            size="small"
            checkedValues={checkedValues}
            className={styles.toolbar}
            onCheckedValueChange={onCheckedValueChange}
        >
            <ToolbarRadioButton
                aria-label="Tree view"
                name={'tableViewMode'}
                value={'Tree'}
                appearance={'transparent'}
                className={styles.viewModeButton}
            >
                Tree
            </ToolbarRadioButton>
            <ToolbarDivider />
            <ToolbarRadioButton
                aria-label="JSON view"
                name={'tableViewMode'}
                value={'JSON'}
                appearance={'transparent'}
                className={styles.viewModeButton}
            >
                JSON
            </ToolbarRadioButton>
            <ToolbarDivider />
            <ToolbarRadioButton
                aria-label="Table view"
                name={'tableViewMode'}
                value={'Table'}
                appearance={'transparent'}
                className={styles.viewModeButton}
            >
                Table
            </ToolbarRadioButton>
            <ToolbarDividerTransparent />
            <ToolbarRadioButton
                aria-label="View mode"
                icon={<EyeRegular />}
                name={'editMode'}
                value={'View'}
                appearance={'transparent'}
                className={styles.editModeButton}
            >
                View
            </ToolbarRadioButton>
            <ToolbarDivider />
            <ToolbarRadioButton
                aria-label="Edit mode"
                icon={<EditRegular />}
                name={'editMode'}
                value={'Edit'}
                appearance={'transparent'}
                className={styles.editModeButton}
            >
                Edit
            </ToolbarRadioButton>
            {isTableViewMode && (
                <>
                    <ToolbarDividerTransparent />
                    <Tooltip content="View selected document in separate tab" relationship="description" withArrow>
                        <ToolbarButton
                            aria-label={'View selected document'}
                            icon={<DocumentArrowDownRegular />}
                            onClick={onViewDocumentClick}
                        />
                    </Tooltip>
                    <Tooltip content="Add new document in separate tab" relationship="description" withArrow>
                        <ToolbarButton
                            aria-label={'Add new document'}
                            icon={<DocumentAddRegular />}
                            onClick={onNewDocumentClick}
                            disabled={!isEditMode}
                        />
                    </Tooltip>
                    <Tooltip content="Edit selected document in separate tab" relationship="description" withArrow>
                        <ToolbarButton
                            aria-label={'Edit selected document'}
                            icon={<DocumentEditRegular />}
                            onClick={onEditDocumentClick}
                            disabled={!isEditMode}
                        />
                    </Tooltip>
                    <Tooltip content="Delete selected document" relationship="description" withArrow>
                        <ToolbarButton
                            aria-label={'Delete selected document'}
                            icon={<DocumentDismissRegular />}
                            onClick={onDeleteDocumentClick}
                            disabled={!isEditMode}
                        />
                    </Tooltip>
                </>
            )}
        </Toolbar>
    );
};
