/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type HotkeyMapping } from '../../common/hotkeys';

export type DocumentHotkeyScope = 'global' | 'document';
export type DocumentHotkeyCommand =
    | 'CopyToClipboard'
    | 'Discard'
    | 'Cancel'
    | 'Refresh'
    | 'SaveToDisk'
    | 'SaveDocument'
    | 'EditDocument';

export const DocumentGlobalHotkeys: HotkeyMapping<DocumentHotkeyCommand>[] = [
    {
        key: 'mod+s',
        command: 'SaveDocument',
        description: 'Save the current document',
        shortcutDisplay: { windows: 'Ctrl+S', mac: '⌘S' },
    },
    {
        key: 'mod+shift+e',
        command: 'EditDocument',
        description: 'Edit the current document',
        shortcutDisplay: { windows: 'Ctrl+Shift+E', mac: '⇧⌘E' },
    },
    {
        key: 'mod+shift+r',
        command: 'Refresh',
        description: 'Refresh the current document',
        shortcutDisplay: { windows: 'Ctrl+Shift+R', mac: '⇧⌘R' },
    },
    {
        key: 'mod+shift+s',
        command: 'SaveToDisk',
        description: 'Download document to disk',
        shortcutDisplay: { windows: 'Ctrl+Shift+S', mac: '⇧⌘S' },
    },
    {
        key: 'escape',
        command: 'Discard',
        description: 'Discard changes',
        shortcutDisplay: { windows: 'Esc', mac: '⎋' },
    },
] as const;
