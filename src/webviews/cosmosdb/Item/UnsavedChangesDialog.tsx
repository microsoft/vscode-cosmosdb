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
} from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';

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
                        <div>
                            {l10n.t('Your item has unsaved changes. If you continue, these changes will be lost.')}
                        </div>
                        <div>{l10n.t('Are you sure you want to continue?')}</div>
                    </DialogContent>

                    <DialogActions>
                        <Button appearance="secondary" onClick={() => void doAction()}>
                            {l10n.t('Continue')}
                        </Button>

                        <DialogTrigger disableButtonEnhancement>
                            <Button appearance="primary">{l10n.t('Close')}</Button>
                        </DialogTrigger>
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
};
