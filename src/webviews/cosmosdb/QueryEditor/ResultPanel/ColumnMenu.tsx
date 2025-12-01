/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Menu, MenuItem, MenuList, MenuPopover, type PositioningImperativeRef } from '@fluentui/react-components';
import { ArrowFitFilled, AutoFitWidthFilled } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import * as React from 'react';
import { useCallback, useEffect } from 'react';
import { type SlickgridReact } from 'slickgrid-react';
import { ColumnResizeDialog } from './ColumnResizeDialog';

// Define the type for the arguments passed to the header button click handler
interface HeaderButtonClickArgs {
    column?: {
        id?: string | number;
    };
}

export const useColumnMenu = (gridRef: React.RefObject<SlickgridReact | null>) => {
    const [resizeDialogOpen, setResizeDialogOpen] = React.useState(false);
    const [currentTarget, setCurrentTarget] = React.useState<HTMLElement | null>(null);
    const [currentColumnId, setCurrentColumnId] = React.useState<string | number>('');
    const [currentColumnWidth, setCurrentColumnWidth] = React.useState(100);
    const [menuOpen, setMenuOpen] = React.useState(false);
    const positioningRef = React.useRef<PositioningImperativeRef>(null);

    // Update positioning when target changes
    useEffect(() => {
        if (currentTarget && positioningRef.current) {
            positioningRef.current.setTarget(currentTarget);
        }
    }, [currentTarget]);

    const handleHeaderButtonClick = useCallback((event: Event, args: HeaderButtonClickArgs) => {
        setCurrentColumnId(`${args?.column?.id ?? ''}`);
        const buttonElement = event.target as HTMLElement;
        if (buttonElement) {
            setCurrentTarget(buttonElement);
            setMenuOpen(true);
        }
    }, []);

    const onColumnResizeByContent = useCallback(
        async (columnId: string | number) => {
            await gridRef.current?.instances?.eventPubSubService?.publish('onHeaderMenuColumnResizeByContent', {
                columnId,
            });
        },
        [gridRef],
    );

    const onColumnResizeDynamic = useCallback(
        (columnId: string | number) => {
            const columns = gridRef.current?.gridService.getAllColumnDefinitions();
            const column = columns?.find((col) => col.id === columnId);
            if (column) {
                setCurrentColumnWidth(column.width || 100);
                setResizeDialogOpen(true);
            }
        },
        [gridRef],
    );

    const applyColumnResize = useCallback(
        (newWidth: number) => {
            const columns = gridRef.current?.gridService.getAllColumnDefinitions();
            const column = columns?.find((col) => col.id === currentColumnId);
            if (column) {
                column.width = newWidth;
                gridRef.current?.grid.reRenderColumns();
            }
        },
        [currentColumnId, gridRef],
    );

    // Create JSX for menu and dialog to be rendered directly in the component
    const MenuElement = (
        <>
            <Menu
                open={menuOpen}
                positioning={{ positioningRef }}
                onOpenChange={(_e, data) => setMenuOpen(data.open)}
                aria-label={l10n.t('Column options')}
            >
                <MenuPopover>
                    <MenuList aria-label={l10n.t('Column resize options')}>
                        <MenuItem
                            icon={<AutoFitWidthFilled />}
                            onClick={() => {
                                void onColumnResizeByContent(currentColumnId);
                                setMenuOpen(false);
                            }}
                            aria-description={l10n.t('Automatically resize column based on content')}
                        >
                            {l10n.t('Resize by Content')}
                        </MenuItem>
                        <MenuItem
                            icon={<ArrowFitFilled />}
                            onClick={() => {
                                onColumnResizeDynamic(currentColumnId);
                                setMenuOpen(false);
                            }}
                            aria-description={l10n.t('Manually set column width')}
                        >
                            {l10n.t('Resize')}
                        </MenuItem>
                    </MenuList>
                </MenuPopover>
            </Menu>
            <ColumnResizeDialog
                isOpen={resizeDialogOpen}
                defaultWidth={currentColumnWidth}
                onClose={() => setResizeDialogOpen(false)}
                onApply={applyColumnResize}
            />
        </>
    );

    return {
        handleHeaderButtonClick,
        MenuElement,
    };
};
