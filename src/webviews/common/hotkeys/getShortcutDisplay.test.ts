/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { getShortcutDisplay } from './getShortcutDisplay';
import { type HotkeyMapping } from './HotkeyTypes';

// `isMac` is computed once at module load from `navigator`, which is absent under the node test
// environment (so it defaults to `false`). We mock the constants module with a live getter so each
// test can flip the platform without re-importing. The variable must be `mock`-prefixed for Vitest
// to allow referencing it from the hoisted factory.
let mockIsMac = false;
vi.mock('../../constants', () => ({
    get isMac() {
        return mockIsMac;
    },
}));

type Command = 'Save' | 'Run' | 'Copy';

const hotkeys: HotkeyMapping<Command>[] = [
    {
        key: 'mod+s',
        command: 'Save',
        shortcutDisplay: { windows: 'Ctrl+S', mac: '⌘S' },
    },
    {
        key: 'mod+enter',
        command: 'Run',
        shortcutDisplay: { windows: 'Ctrl+Enter', mac: '⌘↵' },
    },
    {
        // Mac display intentionally empty to exercise the windows fallback.
        key: 'mod+c',
        command: 'Copy',
        shortcutDisplay: { windows: 'Ctrl+C', mac: '' },
    },
];

describe('getShortcutDisplay', () => {
    beforeEach(() => {
        mockIsMac = false;
    });

    it('returns the windows display on non-mac platforms', () => {
        expect(getShortcutDisplay(hotkeys, 'Save')).toBe('Ctrl+S');
        expect(getShortcutDisplay(hotkeys, 'Run')).toBe('Ctrl+Enter');
    });

    it('returns the mac display on mac platforms', () => {
        mockIsMac = true;
        expect(getShortcutDisplay(hotkeys, 'Save')).toBe('⌘S');
        expect(getShortcutDisplay(hotkeys, 'Run')).toBe('⌘↵');
    });

    it('falls back to the windows display when the mac display is empty', () => {
        mockIsMac = true;
        expect(getShortcutDisplay(hotkeys, 'Copy')).toBe('Ctrl+C');
    });

    it('returns undefined when the command is not in the provided mappings', () => {
        expect(getShortcutDisplay(hotkeys, 'Missing' as Command)).toBeUndefined();
    });

    it('resolves a command that exists in multiple scopes from the provided array only', () => {
        const editorHotkeys: HotkeyMapping<Command>[] = [
            { key: 'mod+s', command: 'Save', shortcutDisplay: { windows: 'Ctrl+S', mac: '⌘S' } },
        ];
        const panelHotkeys: HotkeyMapping<Command>[] = [
            { key: 'mod+shift+s', command: 'Save', shortcutDisplay: { windows: 'Ctrl+Shift+S', mac: '⇧⌘S' } },
        ];

        // Same command, different display per scope: the array passed in disambiguates.
        expect(getShortcutDisplay(editorHotkeys, 'Save')).toBe('Ctrl+S');
        expect(getShortcutDisplay(panelHotkeys, 'Save')).toBe('Ctrl+Shift+S');
    });
});
