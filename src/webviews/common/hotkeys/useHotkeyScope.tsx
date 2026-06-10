/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { isEqual } from 'es-toolkit';
import { useCallback, useMemo } from 'react';
import { useHotkeys, type HotkeyCallback } from 'react-hotkeys-hook';
import { HotkeyCommandService } from './HotkeyCommandService';
import { type HotkeyCommand, type HotkeyMapping, type HotkeyScope } from './HotkeyTypes';

export const useHotkeyScope = <Scope extends HotkeyScope, Command extends HotkeyCommand>(
    scope: Scope,
    hotkeys: HotkeyMapping<Command>[],
) => {
    const commandService = HotkeyCommandService.getInstance<Scope, Command>();

    // Register the scope's static mappings. registerScope is idempotent (the `hotkeys` array is a
    // stable module-level constant), so calling it on every render is safe and survives HMR /
    // StrictMode remounts without any registration flags or teardown races.
    commandService.registerScope(scope, hotkeys);

    const eventHandler = useCallback<HotkeyCallback>(
        (event, handler) => {
            // Find the mapping that matches this key
            if (handler.isSequence) {
                throw new Error(l10n.t('Hotkey sequences are not supported in this context'));
            }

            const pressedModifiers = [
                handler.alt ? 'alt' : '',
                handler.ctrl ? 'ctrl' : '',
                handler.meta ? 'meta' : '',
                handler.shift ? 'shift' : '',
                handler.mod ? 'mod' : '',
            ];
            const pressedKeys = pressedModifiers
                .concat(handler.keys?.join('+') || '')
                .filter((k) => k)
                .sort();

            const mapping = commandService.registeredHotkeys(scope).find((m) =>
                m.key
                    .split(', ')
                    .map((k) => k.split('+').sort())
                    .some((k) => isEqual(k, pressedKeys)),
            );

            if (mapping) {
                // Pass the event to allow handlers to control propagation
                void commandService.executeCommand(scope, mapping.command, event);
            }
        },
        [scope, commandService],
    );

    // Combine all keys for this scope
    const keysString = useMemo(
        () =>
            hotkeys
                .map((m) => m.key)
                .sort()
                .join(', '),
        [hotkeys],
    );

    // react-hotkeys-hook returns a ref. When the caller attaches it to a DOM node, the library
    // scopes the shortcut to that subtree automatically: it only fires when the focused element is
    // the node or one of its descendants. The 'global' scope simply leaves the ref unattached, so
    // its listener stays on the document. This replaces the manual DOM-containment gating we used
    // to do by hand, and the redundant library-level `scopes` option (inactive without a
    // <HotkeysProvider> since react-hotkeys-hook 5.2.0).
    return useHotkeys(keysString, eventHandler, {
        enableOnFormTags: ['textarea', 'input' /*, 'textbox'*/],
        enableOnContentEditable: true,
    });
};
