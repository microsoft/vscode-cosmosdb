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
    Input,
    Label,
    makeStyles,
} from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import * as React from 'react';

interface ColumnResizeDialogProps {
    isOpen: boolean;
    defaultWidth: number;
    onClose: () => void;
    onApply: (width: number) => void;
}

const useStyles = makeStyles({
    root: {
        // Stack the label above the field
        display: 'flex',
        flexDirection: 'column',
        // Use 2px gap below the label (per the design system)
        gap: '2px',
        // Prevent the example from taking the full width of the page (optional)
        maxWidth: '400px',
    },
});

export const ColumnResizeDialog: React.FC<ColumnResizeDialogProps> = ({ isOpen, defaultWidth, onClose, onApply }) => {
    const styles = useStyles();
    const [width, setWidth] = React.useState<number>(defaultWidth);

    React.useEffect(() => {
        if (isOpen) {
            setWidth(defaultWidth);
        }
    }, [isOpen, defaultWidth]);

    const handleApply = () => {
        onApply(width);
        onClose();
    };

    return (
        <Dialog open={isOpen} onOpenChange={(_, { open }) => !open && onClose()}>
            <DialogSurface style={{ width: '300px' }}>
                <DialogBody>
                    <DialogTitle>{l10n.t('Resize Column')}</DialogTitle>
                    <DialogContent>
                        <div className={styles.root}>
                            <Label htmlFor="column-width">{l10n.t('Column Width (px)')}</Label>
                            <Input
                                id="column-width"
                                type="number"
                                value={width.toString()}
                                onChange={(e) => setWidth(Number(e.target.value))}
                                min={50}
                            />
                        </div>
                    </DialogContent>
                    <DialogActions>
                        <Button appearance="secondary" onClick={onClose}>
                            {l10n.t('Cancel')}
                        </Button>
                        <Button appearance="primary" onClick={handleApply}>
                            {l10n.t('Apply')}
                        </Button>
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
};
