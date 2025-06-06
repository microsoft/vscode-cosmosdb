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
import { type DialogOpenChangeEventHandler } from '@fluentui/react-dialog';
import type * as React from 'react';
import { useCallback } from 'react';

export interface AlertDialogProps extends React.PropsWithChildren {
    isOpen: boolean;
    onClose: (confirmed: boolean) => void;
    title: string;
    confirmButtonText: string;
    cancelButtonText: string;
    reverseButtonOrder?: boolean;
}

export const AlertDialog: React.FC<AlertDialogProps> = ({
    isOpen,
    onClose,
    title,
    children,
    confirmButtonText,
    cancelButtonText,
    reverseButtonOrder = false,
}) => {
    const handleOpenChange = useCallback<DialogOpenChangeEventHandler>(
        (_event, data) => {
            if (!data.open) {
                onClose(false); // Closed without confirmation (via escape key, clicking outside, etc.)
            }
        },
        [onClose],
    );

    const handleConfirm = useCallback(() => {
        onClose(true); // Closed with confirmation
    }, [onClose]);

    const renderButtons = () => {
        const confirmButton = (
            <Button appearance="primary" onClick={handleConfirm}>
                {confirmButtonText}
            </Button>
        );

        const cancelButton = (
            <DialogTrigger disableButtonEnhancement>
                <Button appearance="secondary">{cancelButtonText}</Button>
            </DialogTrigger>
        );

        return reverseButtonOrder ? (
            <>
                {cancelButton}
                {confirmButton}
            </>
        ) : (
            <>
                {confirmButton}
                {cancelButton}
            </>
        );
    };

    return (
        <Dialog modalType="alert" open={isOpen} onOpenChange={handleOpenChange}>
            <DialogSurface>
                <DialogBody>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogContent>{children}</DialogContent>
                    <DialogActions>{renderButtons()}</DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
};
