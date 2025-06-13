/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type HotkeyMapping } from '../../common/hotkeys';

export type QueryEditorHotkeyScope = 'global' | 'queryEditor' | 'resultPanel';
export type QueryEditorHotkeyCommand =
    | 'Refresh'
    | 'Cancel'
    | 'CopyToClipboard'
    | 'SaveToDisk'
    | 'SaveDocument'
    | 'EditDocument'
    | 'ExecuteQuery'
    | 'OpenQuery'
    | 'DuplicateQueryEditor'
    | 'NewItem'
    | 'EditItem'
    | 'ViewItem'
    | 'DeleteItem'
    | 'SwitchToResultTab'
    | 'SwitchToStatsTab'
    | 'SwitchToFirstPage'
    | 'SwitchToNextPage'
    | 'SwitchToPreviousPage';

export const QueryEditorGlobalHotkeys: HotkeyMapping<QueryEditorHotkeyCommand>[] = [
    {
        key: 'mod+alt+d',
        command: 'DuplicateQueryEditor',
        description: 'Duplicate query',
        shortcutDisplay: { windows: 'Ctrl+Alt+D', mac: '⌥⌘D' },
    },
    {
        key: 'alt+1',
        command: 'SwitchToResultTab',
        description: 'Switch to result tab',
        shortcutDisplay: { windows: 'Alt+1', mac: '⌥1' },
    },
    {
        key: 'alt+2',
        command: 'SwitchToStatsTab',
        description: 'Switch to stats tab',
        shortcutDisplay: { windows: 'Alt+2', mac: '⌥2' },
    },
] as const;

export const QueryEditorHotkeys: HotkeyMapping<QueryEditorHotkeyCommand>[] = [
    {
        key: 'f5, shift+enter',
        command: 'ExecuteQuery',
        description: 'Execute query',
        shortcutDisplay: { windows: 'F5, Shift+Enter', mac: 'F5, ⇧↩' },
    },
    {
        key: 'mod+s',
        command: 'SaveToDisk',
        description: 'Save query',
        shortcutDisplay: { windows: 'Ctrl+S', mac: '⌘S' },
    },
    {
        key: 'escape',
        command: 'Cancel',
        description: 'Cancel query execution',
        shortcutDisplay: { windows: 'Esc', mac: '⎋' },
    },
    {
        key: 'mod+o',
        command: 'OpenQuery',
        description: 'Open query',
        shortcutDisplay: { windows: 'Ctrl+O', mac: '⌘O' },
    },
] as const;

export const ResultPanelHotkeys: HotkeyMapping<QueryEditorHotkeyCommand>[] = [
    {
        key: 'alt+i, insert',
        command: 'NewItem',
        description: 'Create new item',
        shortcutDisplay: { windows: 'Alt+I, Insert', mac: '⌥I, Insert' },
    },
    {
        key: 'alt+d, delete',
        command: 'DeleteItem',
        description: 'Delete item',
        shortcutDisplay: { windows: 'Alt+D, Delete', mac: '⌥D, Delete' },
    },
    {
        key: 'alt+e, ctrl+shift+enter',
        command: 'EditItem',
        description: 'Edit item',
        shortcutDisplay: { windows: 'Alt+E, Ctrl+Shift+Enter', mac: '⌥E, ⇧⌘↩' },
    },
    {
        key: 'alt+v, shift+enter',
        command: 'ViewItem',
        description: 'View item',
        shortcutDisplay: { windows: 'Alt+V, Shift+Enter', mac: '⌥V, ⇧↩' },
    },
    {
        key: 'alt+home',
        command: 'SwitchToFirstPage',
        description: 'Switch to first page',
        shortcutDisplay: { windows: 'Alt+Home', mac: '⌥Home' },
    },
    {
        key: 'alt+arrowright',
        command: 'SwitchToNextPage',
        description: 'Switch to next page',
        shortcutDisplay: { windows: 'Alt+Right', mac: '⌥→' },
    },
    {
        key: 'alt+arrowleft',
        command: 'SwitchToPreviousPage',
        description: 'Switch to previous page',
        shortcutDisplay: { windows: 'Alt+Left', mac: '⌥←' },
    },
    {
        key: 'f5, mod+shift+r',
        command: 'Refresh',
        description: 'Refresh results',
        shortcutDisplay: { windows: 'F5, Ctrl+Shift+R', mac: '⇧⌘R' },
    },
    {
        key: 'mod+c',
        command: 'CopyToClipboard',
        description: 'Copy selected item to clipboard',
        shortcutDisplay: { windows: 'Ctrl+C', mac: '⌘C' },
    },
    {
        key: 'mod+s',
        command: 'SaveToDisk',
        description: 'Save selected item to disk',
        shortcutDisplay: { windows: 'Ctrl+S', mac: '⌘S' },
    },
] as const;
