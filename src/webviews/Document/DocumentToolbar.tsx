/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    DialogTrigger,
    Toolbar,
    ToolbarButton,
    Tooltip,
} from '@fluentui/react-components';
import { ArrowClockwiseRegular, EditRegular, SaveRegular } from '@fluentui/react-icons';
import { useState } from 'react';
import { useDocumentDispatcher, useDocumentState } from './state/DocumentContext';

type AlertDialogProps = {
    open: boolean;
    setOpen: (open: boolean) => void;
    doAction: () => Promise<void>;
};

const AlertDialog = ({ open, setOpen, doAction }: AlertDialogProps) => {
    return (
        <Dialog modalType="alert" open={open} onOpenChange={(_event, data) => setOpen(data.open)}>
            <DialogSurface>
                <DialogBody>
                    <DialogTitle>Attention</DialogTitle>
                    <DialogContent>
                        <div>Your document has unsaved changes. If you continue, these changes will be lost.</div>
                        <div>Are you sure you want to continue?</div>
                    </DialogContent>

                    <DialogActions>
                        <Button appearance="secondary" onClick={() => void doAction()}>
                            Continue
                        </Button>

                        <DialogTrigger disableButtonEnhancement>
                            <Button appearance="primary">Close</Button>
                        </DialogTrigger>
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
};

const ToolbarDividerTransparent = () => {
    return <div style={{ padding: '4px' }} />;
};

export const DocumentToolbar = () => {
    const state = useDocumentState();
    const dispatcher = useDocumentDispatcher();

    const [open, setOpen] = useState(false);
    const [doAction, setDoAction] = useState<() => Promise<void>>(() => async () => {});

    const inProgress = state.isSaving || state.isRefreshing;
    const hasDocumentInDB = state.documentId !== undefined;
    const isDirty = state.isDirty;
    const isReadOnly = state.mode === 'view';

    const onSaveRequest = () => {
        // Save document to the database
        void dispatcher.saveDocument(state.currentDocumentContent);
    };

    const onEditRequest = () => {
        // Open document for editing
        void dispatcher.setMode('edit');
    };

    const onRefreshRequest = () => {
        // Reload original document from the database
        if (state.isDirty) {
            setOpen(true);
            setDoAction(() => async () => {
                setOpen(false);
                await dispatcher.refreshDocument();
            });
        } else {
            void dispatcher.refreshDocument();
        }
    };

    return (
        <>
            <AlertDialog open={open} setOpen={setOpen} doAction={doAction} />
            <Toolbar size={'small'}>
                {!isReadOnly && (
                    <Tooltip content="Save document to the database" relationship="description" withArrow>
                        <ToolbarButton
                            onClick={onSaveRequest}
                            aria-label="Save document to the database"
                            icon={<SaveRegular />}
                            appearance={'primary'}
                            disabled={inProgress || !isDirty || !state.isValid}
                        >
                            Save
                        </ToolbarButton>
                    </Tooltip>
                )}
                {isReadOnly && (
                    <Tooltip content="Open document for editing" relationship="description" withArrow>
                        <ToolbarButton
                            onClick={onEditRequest}
                            aria-label="Open document for editing"
                            icon={<EditRegular />}
                            appearance={'primary'}
                        >
                            Edit
                        </ToolbarButton>
                    </Tooltip>
                )}

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
        </>
    );
};
