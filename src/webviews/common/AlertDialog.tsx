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
    useId,
} from '@fluentui/react-components';
import { type DialogOpenChangeEventHandler } from '@fluentui/react-dialog';
import type * as React from 'react';
import { useCallback, useEffect, useRef } from 'react';

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
    const dialogId = useId('dialog-');
    const buttonRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (isOpen && buttonRef.current) {
            buttonRef.current.focus();
        }
    }, [isOpen]);

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
            <DialogTrigger disableButtonEnhancement>
                <Button appearance="primary" onClick={handleConfirm}>
                    {confirmButtonText}
                </Button>
            </DialogTrigger>
        );

        const cancelButton = (
            <DialogTrigger disableButtonEnhancement>
                <Button ref={buttonRef} appearance="secondary">
                    {cancelButtonText}
                </Button>
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
            <DialogSurface aria-labelledby={`${dialogId}-title`} aria-describedby={`${dialogId}-content`}>
                <DialogBody>
                    <DialogTitle id={`${dialogId}-title`}>{title}</DialogTitle>
                    <DialogContent id={`${dialogId}-content`}>{children}</DialogContent>
                    <DialogActions>{renderButtons()}</DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
};
