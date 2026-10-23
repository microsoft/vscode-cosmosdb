/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, mergeClasses, slot, tokens, Tooltip, type TooltipProps } from '@fluentui/react-components';
import { useActiveVSCodeThemeKind } from '@microsoft/vscode-ext-webview-fluentui';

const useStyles = makeStyles({
    inverted: {
        backgroundColor: tokens.colorNeutralBackgroundInverted,
        color: tokens.colorNeutralForegroundInverted,
    },
});

export function useThemedTooltipClassName(): string | undefined {
    const styles = useStyles();
    return useActiveVSCodeThemeKind() === 'vscode-dark' ? styles.inverted : undefined;
}

export function ThemedTooltip({ content, ...props }: TooltipProps) {
    const className = useThemedTooltipClassName();
    const contentSlot = slot.resolveShorthand(content);
    return (
        <Tooltip {...props} content={{ ...contentSlot, className: mergeClasses(contentSlot.className, className) }} />
    );
}

// Preserve Fluent's trigger traversal when a tooltip is nested inside a menu or popover trigger.
ThemedTooltip.isFluentTriggerComponent = true;
