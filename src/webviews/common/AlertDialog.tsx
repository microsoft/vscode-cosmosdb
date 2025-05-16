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
import * as React from 'react';
import { useCallback } from 'react';
export interface AlertDialogProps {
    isOpen: boolean;
    onClose: (confirmed: boolean) => void;
    title: string;
    content: React.ReactNode;
    confirmButtonText: string;
    cancelButtonText: string;
    reverseButtonOrder?: boolean;
}

export const AlertDialog: React.FC<AlertDialogProps> = ({
    isOpen,
    onClose,
    title,
    content,
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

    // Render buttons in the specified order
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
                    <DialogContent>{content}</DialogContent>
                    <DialogActions>{renderButtons()}</DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
};
