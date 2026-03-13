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
    useRestoreFocusSource,
    useRestoreFocusTarget,
} from '@fluentui/react-components';
import { ArrowFitFilled, AutoFitWidthFilled, ChevronDownRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type ColumnWidths, type RenderHeaderCellProps } from 'react-data-grid';
import { createPortal } from 'react-dom';
import { ColumnResizeDialog } from '../ColumnResizeDialog';

const useStyles = makeStyles({
    headerCell: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
        height: '100%',
        gap: '4px',
        paddingLeft: '8px',
        paddingRight: '4px',
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
    // Visually hidden but accessible to screen readers
    srOnly: {
        position: 'absolute',
        width: '1px',
        height: '1px',
        padding: '0',
        margin: '-1px',
        overflow: 'hidden',
        clip: 'rect(0, 0, 0, 0)',
        whiteSpace: 'nowrap',
        border: '0',
    },
});

type ColumnHeaderMenuProps<R, SR = unknown> = RenderHeaderCellProps<R, SR> & {
    columnWidths: ColumnWidths;
    onColumnWidthsChange: (columnWidths: ColumnWidths) => void;
};

export const ColumnHeaderCell = <R, SR = unknown>({
    column,
    columnWidths,
    onColumnWidthsChange,
}: ColumnHeaderMenuProps<R, SR>) => {
    const styles = useStyles();
    const [menuOpen, setMenuOpen] = useState(false);
    const [resizeDialogOpen, setResizeDialogOpen] = useState(false);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const headerCellRef = useRef<HTMLDivElement>(null);
    const columnHeaderRef = useRef<HTMLDivElement | null>(null);

    // Fluent UI focus restoration hooks
    const restoreFocusTargetAttribute = useRestoreFocusTarget();
    const restoreFocusSourceAttribute = useRestoreFocusSource();

    const columnKey = column.key;
    const displayText = typeof column.name === 'string' ? column.name : columnKey;
    const isSortable = column.sortable;

    // Add keyboard event listener to parent columnheader element
    useEffect(() => {
        columnHeaderRef.current = headerCellRef.current?.closest('[role="columnheader"]') as HTMLDivElement | null;
        if (!columnHeaderRef.current) return;

        // Add aria-describedby to the columnheader for proper screen reader announcement
        const hintId = `${columnKey}-hint`;
        columnHeaderRef.current.setAttribute('aria-describedby', hintId);

        const handleKeyDown = (e: KeyboardEvent) => {
            // ArrowDown - ignore, let grid handle navigation
            if (e.key === 'ArrowDown' && !e.altKey) {
                return;
            }

            // Alt+ArrowDown - open menu
            if (e.key === 'ArrowDown' && e.altKey) {
                e.preventDefault();
                e.stopPropagation();
                buttonRef.current?.focus();
                setMenuOpen(true);
                return;
            }

            // Enter - open menu only if column is NOT sortable
            if (e.key === 'Enter') {
                if (!isSortable) {
                    e.preventDefault();
                    e.stopPropagation();
                    buttonRef.current?.focus();
                    setMenuOpen(true);
                }
                // If sortable, do nothing - let grid handle sorting
                return;
            }

            // Space - move focus to button
            if (e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                buttonRef.current?.focus();
                return;
            }

            if (e.key === 'Escape') {
                buttonRef.current?.blur();
                setMenuOpen(false);
                return;
            }
        };

        columnHeaderRef.current.addEventListener('keydown', handleKeyDown);
        return () => {
            columnHeaderRef.current?.removeEventListener('keydown', handleKeyDown);
            columnHeaderRef.current?.removeAttribute('aria-describedby');
        };
    }, [columnKey, isSortable]);

    // Get current width from columnWidths or use default
    const currentWidth = columnWidths.get(columnKey)?.width ?? column.minWidth ?? 150;

    const handleResizeByContent = useCallback(() => {
        // Set width to 'measured' type which triggers auto-sizing
        const newWidths = new Map(columnWidths);
        newWidths.delete(columnKey); // Remove resized width to let it be measured
        onColumnWidthsChange(newWidths);
        setMenuOpen(false);
    }, [columnKey, columnWidths, onColumnWidthsChange]);

    const handleOpenResizeDialog = useCallback(() => {
        setResizeDialogOpen(true);
        setMenuOpen(false);
    }, []);

    const handleApplyResize = useCallback(
        (newWidth: number) => {
            const newWidths = new Map(columnWidths);
            newWidths.set(columnKey, { type: 'resized', width: newWidth });
            onColumnWidthsChange(newWidths);
        },
        [columnKey, columnWidths, onColumnWidthsChange],
    );

    const handleDialogClose = useCallback(() => {
        setResizeDialogOpen(false);
    }, []);

    // Handle keyboard events on the menu button
    const handleButtonKeyDown = useCallback((e: React.KeyboardEvent<HTMLButtonElement>) => {
        if (e.key === 'Escape') {
            // Return focus to header cell
            e.stopPropagation();
            e.preventDefault();
            setMenuOpen(false);
            columnHeaderRef.current?.focus();
        } else if (e.key === 'ArrowDown') {
            // ArrowDown on button should NOT open menu
            e.preventDefault();
        }
    }, []);

    // Prevent header cell from capturing focus on mouse down
    const handleButtonMouseDown = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
        e.stopPropagation();
    }, []);

    // Aria description for keyboard hint
    const keyboardHint = l10n.t('Press Alt+Down to open column menu');

    return (
        <>
            <div ref={headerCellRef} className={styles.headerCell}>
                <span className={styles.headerText} title={displayText}>
                    {displayText}
                </span>
                <Menu open={menuOpen} onOpenChange={(_e, data) => setMenuOpen(data.open)}>
                    <MenuTrigger disableButtonEnhancement>
                        <Button
                            ref={buttonRef}
                            className={styles.menuButton}
                            appearance="subtle"
                            icon={<ChevronDownRegular />}
                            aria-label={l10n.t('Column context menu for {0}', displayText)}
                            aria-haspopup="menu"
                            aria-expanded={menuOpen}
                            aria-hidden={!menuOpen}
                            tabIndex={-1}
                            onClick={() => setMenuOpen((prev) => !prev)}
                            onKeyDown={handleButtonKeyDown}
                            onMouseDown={handleButtonMouseDown}
                            {...restoreFocusTargetAttribute}
                        />
                    </MenuTrigger>
                    <MenuPopover>
                        <MenuList aria-label={l10n.t('Column resize options.')}>
                            <MenuItem
                                icon={<AutoFitWidthFilled />}
                                onClick={handleResizeByContent}
                                aria-label={l10n.t('Resize by Content') + '.'}
                                aria-description={l10n.t('Automatically resize column based on content')}
                                {...restoreFocusSourceAttribute}
                            >
                                {l10n.t('Resize by Content')}
                            </MenuItem>
                            <MenuItem
                                icon={<ArrowFitFilled />}
                                onClick={handleOpenResizeDialog}
                                aria-label={l10n.t('Resize') + '.'}
                                aria-description={l10n.t('Manually set column width')}
                                {...restoreFocusSourceAttribute}
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
                onClose={handleDialogClose}
                onApply={(newWidth: number) => {
                    handleApplyResize(newWidth);
                    handleDialogClose();
                }}
            />
            {/* Keyboard hint for screen readers - rendered outside grid via portal */}
            {createPortal(
                <div id={`${columnKey}-hint`} className={styles.srOnly}>
                    {keyboardHint}
                </div>,
                document.body,
            )}
        </>
    );
};
