/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    makeStyles,
    MenuItem,
    ToolbarButton,
    Tooltip,
    useRestoreFocusSource,
    useRestoreFocusTarget,
    type MenuItemProps,
    type ToolbarButtonProps,
} from '@fluentui/react-components';
import type React from 'react';
import { forwardRef, type ForwardedRef } from 'react';

const useStyles = makeStyles({
    tooltip: {
        maxWidth: '400px',
    },
});

// Helper function to ensure ariaLabel ends with a stop symbol
const ensureStopSymbol = (text: string): string => {
    text = text.trim();
    // Check if the text already ends with a stop symbol
    if (/[.,!?;:…]$/.test(text)) {
        return text;
    }
    // Add a period if no stop symbol is present
    return text + '.';
};

type ToolbarOverflowButtonProps = {
    ariaLabel: string;
    content: React.ReactNode | string;
    disabled?: boolean;
    icon?: React.ReactElement;
    hotkey?: string;
    onClick: (() => Promise<void> | void) | undefined;
    refs?: ForwardedRef<HTMLButtonElement>;
    showButtonText?: boolean;
    tooltip: string;
    type: 'button' | 'menuitem';
    menuItemProps?: MenuItemProps;
    toolbarButtonProps?: ToolbarButtonProps;
};

export const ToolbarOverflowButton = forwardRef(function ToolbarOverflowButton(
    props: ToolbarOverflowButtonProps,
    ref: ForwardedRef<HTMLButtonElement>,
) {
    const classes = useStyles();
    const { ariaLabel, content, disabled, icon, hotkey, onClick, showButtonText, tooltip, type } = props;
    const formattedAriaLabel = ensureStopSymbol(ariaLabel);

    const restoreFocusTargetAttribute = useRestoreFocusTarget();
    const restoreFocusSourceAttribute = useRestoreFocusSource();

    if (type === 'button') {
        return (
            <Tooltip
                content={{ children: tooltip + `${hotkey ? ` (${hotkey})` : ''}`, className: classes.tooltip }}
                relationship={showButtonText ? 'description' : 'label'}
                appearance="inverted"
                withArrow
            >
                <ToolbarButton
                    ref={props.refs ?? ref}
                    {...props.toolbarButtonProps}
                    // eslint-disable-next-line @typescript-eslint/no-misused-promises
                    onClick={onClick}
                    aria-label={formattedAriaLabel}
                    aria-keyshortcuts={hotkey}
                    icon={icon}
                    disabled={disabled}
                    {...restoreFocusTargetAttribute}
                >
                    {showButtonText !== false ? content : undefined}
                </ToolbarButton>
            </Tooltip>
        );
    }

    if (type === 'menuitem') {
        return (
            <MenuItem
                {...props.menuItemProps}
                // eslint-disable-next-line @typescript-eslint/no-misused-promises
                onClick={onClick}
                secondaryContent={hotkey}
                aria-label={formattedAriaLabel}
                icon={icon}
                disabled={disabled}
                {...restoreFocusSourceAttribute}
            >
                {content}
            </MenuItem>
        );
    }

    return <></>;
});
