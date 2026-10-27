/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Tooltip, type TooltipProps } from '@fluentui/react-components';
import { useActiveVSCodeThemeKind } from '@microsoft/vscode-ext-webview-fluentui';

export function ThemedTooltip(props: TooltipProps) {
    const themeKind = useActiveVSCodeThemeKind();
    return <Tooltip appearance={themeKind === 'vscode-dark' ? 'inverted' : 'normal'} {...props} />;
}

// Preserve Fluent's trigger traversal when a tooltip is nested inside a menu or popover trigger.
ThemedTooltip.isFluentTriggerComponent = true;
