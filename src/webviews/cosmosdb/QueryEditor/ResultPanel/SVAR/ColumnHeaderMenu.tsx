/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    makeStyles,
    Menu,
    MenuItem,
    MenuList,
    MenuPopover,
    MenuTrigger,
    tokens,
} from '@fluentui/react-components';
import { ArrowFitFilled, AutoFitWidthFilled, ChevronDownRegular } from '@fluentui/react-icons';
import { type ICellProps, type IHeaderCell } from '@svar-ui/react-grid';
import * as l10n from '@vscode/l10n';
import { useState } from 'react';
import { ColumnResizeDialog } from '../ColumnResizeDialog';

const useStyles = makeStyles({
    headerCell: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
        height: '100%',
        gap: '4px',
        padding: '0 4px',
    },
    headerText: {
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        flex: 1,
    },
    menuButton: {
        minWidth: 'unset',
        padding: '2px',
        height: '20px',
        width: '20px',
        flexShrink: 0,
        backgroundColor: 'transparent',
        border: 'none',
        color: tokens.colorNeutralForeground2,
        ':hover': {
            backgroundColor: tokens.colorNeutralBackground1Hover,
            color: tokens.colorNeutralForeground1,
        },
    },
});

type ColumnHeaderMenuProps = ICellProps & {
    cell: Omit<IHeaderCell, 'cell'>;
} & {
    onAction: (ev: { action?: string; data?: { [key: string]: unknown } }) => void;
};

export const ColumnHeaderCell = ({ column, cell, onAction }: ColumnHeaderMenuProps) => {
    const styles = useStyles();
    const [menuOpen, setMenuOpen] = useState(false);
    const [resizeDialogOpen, setResizeDialogOpen] = useState(false);

    const columnId = (column?.id as string) ?? '';
    const currentWidth = column?.width || 150;
    const displayText = cell.text ?? columnId.replace(/_id$/, '');

    const handleResizeByContent = () => {
        onAction?.({
            action: 'resize-column',
            data: {
                id: columnId,
                auto: true,
            },
        });
        setMenuOpen(false);
    };

    const handleOpenResizeDialog = () => {
        setResizeDialogOpen(true);
        setMenuOpen(false);
    };

    const handleApplyResize = (newWidth: number) => {
        onAction?.({
            action: 'resize-column',
            data: {
                id: columnId,
                width: newWidth,
            },
        });
    };

    return (
        <>
            <div className={styles.headerCell}>
                <span className={styles.headerText} title={displayText}>
                    {displayText}
                </span>
                <Menu open={menuOpen} onOpenChange={(_e, data) => setMenuOpen(data.open)}>
                    <MenuTrigger disableButtonEnhancement>
                        <Button
                            className={styles.menuButton}
                            appearance="subtle"
                            icon={<ChevronDownRegular />}
                            aria-label={l10n.t('Column options for {0}', displayText)}
                            onClick={(e) => {
                                e.stopPropagation();
                                setMenuOpen(!menuOpen);
                            }}
                        />
                    </MenuTrigger>
                    <MenuPopover>
                        <MenuList aria-label={l10n.t('Column resize options')}>
                            <MenuItem
                                icon={<AutoFitWidthFilled />}
                                onClick={handleResizeByContent}
                                aria-description={l10n.t('Automatically resize column based on content')}
                            >
                                {l10n.t('Resize by Content')}
                            </MenuItem>
                            <MenuItem
                                icon={<ArrowFitFilled />}
                                onClick={handleOpenResizeDialog}
                                aria-description={l10n.t('Manually set column width')}
                            >
                                {l10n.t('Resize')}
                            </MenuItem>
                        </MenuList>
                    </MenuPopover>
                </Menu>
            </div>
            <ColumnResizeDialog
                isOpen={resizeDialogOpen}
                defaultWidth={currentWidth}
                onClose={() => setResizeDialogOpen(false)}
                onApply={handleApplyResize}
            />
        </>
    );
};
