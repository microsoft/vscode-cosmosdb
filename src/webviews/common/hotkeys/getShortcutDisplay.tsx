/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isMac } from '../../constants';
import { type HotkeyCommand, type HotkeyMapping } from './HotkeyTypes';

/**
 * Resolves the platform-specific display string (e.g. "Ctrl+S" / "⌘S") for a command within a given
 * set of hotkey mappings.
 *
 * This is a pure lookup over the static, module-level hotkey definitions — it does not depend on any
 * runtime registration. Pass the specific scope's mapping array so that commands shared across
 * scopes (e.g. `SaveToDisk` in both the query editor and the result panel) resolve unambiguously.
 */
export const getShortcutDisplay = <Command extends HotkeyCommand>(
    hotkeys: readonly HotkeyMapping<Command>[],
    command: Command,
): string | undefined => {
    const mapping = hotkeys.find((hk) => hk.command === command);
    if (!mapping) {
        return undefined;
    }
    return mapping.shortcutDisplay[isMac ? 'mac' : 'windows'] || mapping.shortcutDisplay.windows;
};
