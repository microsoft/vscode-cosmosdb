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
    DialogTitle, DialogTrigger,
} from '@fluentui/react-components';

export type AlertDialogProps = {
    open: boolean;
    setOpen: (open: boolean) => void;
    doAction: () => Promise<void>;
};

export const UnsavedChangesDialog = ({ open, setOpen, doAction }: AlertDialogProps) => {
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
