/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export enum HotkeyScope {
    Global = 'global',
    QueryEditor = 'queryEditor',
    ResultPanel = 'resultPanel',
    DocumentEditor = 'documentEditor',
}

export enum CommandType {
    // Common commands
    CopyToClipboard = 0,
    SaveToDisk = 1,
    Discard = 2,
    Cancel = 3,
    Refresh = 4,

    // Document commands
    SaveDocument = 101, // Save current document on cloud
    EditDocument = 102,

    // Query commands
    ExecuteQuery = 201,
    OpenQuery = 202,
    DuplicateQueryEditor = 203,

    // Result panel commands
    NewItem = 301,
    EditItem = 302,
    ViewItem = 303,
    DeleteItem = 304,
    SwitchToResultTab = 305,
    SwitchToStatsTab = 306,
    SwitchToFirstPage = 307,
    SwitchToNextPage = 308,
    SwitchToPreviousPage = 309,
}

export interface HotkeyMapping {
    key: string;
    command: CommandType;
    scope: HotkeyScope;
    description?: string; // Optional description for the hotkey
    shortcutDisplay: {
        windows: string;
        mac: string;
    };
}

// Updated mappings based on Azure Data Explorer shortcuts
export const defaultHotkeyMappings: HotkeyMapping[] = [
    // Document commands
    {
        key: 'mod+s',
        command: CommandType.SaveDocument,
        scope: HotkeyScope.DocumentEditor,
        description: 'Save the current document',
        shortcutDisplay: { windows: 'Ctrl+S', mac: '⌘S' },
    },
    {
        key: 'mod+shift+e',
        command: CommandType.EditDocument,
        scope: HotkeyScope.DocumentEditor,
        description: 'Edit the current document',
        shortcutDisplay: { windows: 'Ctrl+Shift+E', mac: '⇧⌘E' },
    },
    {
        key: 'mod+shift+r',
        command: CommandType.Refresh,
        scope: HotkeyScope.DocumentEditor,
        description: 'Refresh the current document',
        shortcutDisplay: { windows: 'Ctrl+Shift+R', mac: '⇧⌘R' },
    },
    {
        key: 'mod+shift+s',
        command: CommandType.SaveToDisk,
        scope: HotkeyScope.DocumentEditor,
        description: 'Download document to disk',
        shortcutDisplay: { windows: 'Ctrl+Shift+S', mac: '⇧⌘S' },
    },
    {
        key: 'escape',
        command: CommandType.Discard,
        scope: HotkeyScope.DocumentEditor,
        description: 'Discard changes',
        shortcutDisplay: { windows: 'Esc', mac: '⎋' },
    },

    // Query commands
    {
        key: 'f5, shift+enter',
        command: CommandType.ExecuteQuery,
        scope: HotkeyScope.QueryEditor,
        description: 'Execute query',
        shortcutDisplay: { windows: 'F5, Shift+Enter', mac: 'F5, ⇧↩' },
    },
    {
        key: 'mod+s',
        command: CommandType.SaveToDisk,
        scope: HotkeyScope.QueryEditor,
        description: 'Save query',
        shortcutDisplay: { windows: 'Ctrl+S', mac: '⌘S' },
    },
    {
        key: 'escape',
        command: CommandType.Cancel,
        scope: HotkeyScope.QueryEditor,
        description: 'Cancel query execution',
        shortcutDisplay: { windows: 'Esc', mac: '⎋' },
    },
    {
        key: 'mod+o',
        command: CommandType.OpenQuery,
        scope: HotkeyScope.QueryEditor,
        description: 'Open query',
        shortcutDisplay: { windows: 'Ctrl+O', mac: '⌘O' },
    },
    {
        key: 'mod+alt+d',
        command: CommandType.DuplicateQueryEditor,
        scope: HotkeyScope.Global,
        description: 'Duplicate query',
        shortcutDisplay: { windows: 'Ctrl+Alt+D', mac: '⌥⌘D' },
    },

    // Result panel commands
    {
        key: 'alt+i, insert',
        command: CommandType.NewItem,
        scope: HotkeyScope.ResultPanel,
        description: 'Create new item',
        shortcutDisplay: { windows: 'Alt+I, Insert', mac: '⌥I, Insert' },
    },
    {
        key: 'alt+d, delete',
        command: CommandType.DeleteItem,
        scope: HotkeyScope.ResultPanel,
        description: 'Delete item',
        shortcutDisplay: { windows: 'Alt+D, Delete', mac: '⌥D, Delete' },
    },
    {
        key: 'alt+e, ctrl+shift+enter',
        command: CommandType.EditItem,
        scope: HotkeyScope.ResultPanel,
        description: 'Edit item',
        shortcutDisplay: { windows: 'Alt+E, Ctrl+Shift+Enter', mac: '⌥E, ⇧⌘↩' },
    },
    {
        key: 'alt+v, shift+enter',
        command: CommandType.ViewItem,
        scope: HotkeyScope.ResultPanel,
        description: 'View item',
        shortcutDisplay: { windows: 'Alt+V, Shift+Enter', mac: '⌥V, ⇧↩' },
    },
    {
        key: 'alt+1',
        command: CommandType.SwitchToResultTab,
        scope: HotkeyScope.Global,
        description: 'Switch to result tab',
        shortcutDisplay: { windows: 'Alt+1', mac: '⌥1' },
    },
    {
        key: 'alt+2',
        command: CommandType.SwitchToStatsTab,
        scope: HotkeyScope.Global,
        description: 'Switch to stats tab',
        shortcutDisplay: { windows: 'Alt+2', mac: '⌥2' },
    },
    {
        key: 'alt+home',
        command: CommandType.SwitchToFirstPage,
        scope: HotkeyScope.ResultPanel,
        description: 'Switch to first page',
        shortcutDisplay: { windows: 'Alt+Home', mac: '⌥Home' },
    },
    {
        key: 'alt+arrowright',
        command: CommandType.SwitchToNextPage,
        scope: HotkeyScope.ResultPanel,
        description: 'Switch to next page',
        shortcutDisplay: { windows: 'Alt+Right', mac: '⌥→' },
    },
    {
        key: 'alt+arrowleft',
        command: CommandType.SwitchToPreviousPage,
        scope: HotkeyScope.ResultPanel,
        description: 'Switch to previous page',
        shortcutDisplay: { windows: 'Alt+Left', mac: '⌥←' },
    },
    {
        key: 'f5, mod+shift+r',
        command: CommandType.Refresh,
        scope: HotkeyScope.ResultPanel,
        description: 'Refresh results',
        shortcutDisplay: { windows: 'F5, Ctrl+Shift+R', mac: '⇧⌘R' },
    },
    {
        key: 'mod+c',
        command: CommandType.CopyToClipboard,
        scope: HotkeyScope.ResultPanel,
        description: 'Copy selected item to clipboard',
        shortcutDisplay: { windows: 'Ctrl+C', mac: '⌘C' },
    },
    {
        key: 'mod+s',
        command: CommandType.SaveToDisk,
        scope: HotkeyScope.ResultPanel,
        description: 'Save selected item to disk',
        shortcutDisplay: { windows: 'Ctrl+S', mac: '⌘S' },
    },
];

/**
 * Finds hotkey mappings by command type and optional scope
 * @param command The command type to find
 * @param scope Optional scope to filter by
 * @returns Array of matching hotkey mappings (empty if none found)
 */
export function findHotkeyMapping(command: CommandType, scope?: HotkeyScope): HotkeyMapping[] {
    return defaultHotkeyMappings.filter(
        (mapping) => mapping.command === command && (scope === undefined || mapping.scope === scope),
    );
}
