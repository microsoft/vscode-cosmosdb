/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { isEqual } from 'es-toolkit';
import { useEffect, type RefObject } from 'react';
import { useHotkeys, useHotkeysContext } from 'react-hotkeys-hook';
import { HotkeyCommandService } from './HotkeyCommandService';
import { HotkeyScope } from './HotkeyTypes';

export const useHotkeyScope = (scope: HotkeyScope) => {
    const commandService = HotkeyCommandService.getInstance();
    const { enableScope, disableScope } = useHotkeysContext();

    // Get all hotkey mappings for this scope
    const mappings = commandService.getMappingsForScope(scope);

    // Combine all keys for this scope
    const keysString = mappings.map((m) => m.key).join(', ');

    // Use react-hotkeys-hook to handle hotkeys
    const ref = useHotkeys(
        keysString,
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

            const mapping = mappings.find((m) =>
                m.key
                    .split(', ')
                    .map((k) => k.split('+').sort())
                    .some((k) => isEqual(k, pressedKeys)),
            );

            if (mapping) {
                // Pass the event to allow handlers to control propagation
                void commandService.executeCommand(mapping.command, event, scope);
            }
        },
        {
            enableOnFormTags: ['textarea', 'input'],
            enableOnContentEditable: true,
            scopes: scope, // Use the scope name as the scope identifier
        },
    );

    // Manage scope enabling/disabling based on DOM attachment
    useEffect(() => {
        // Register this ref with the command service
        commandService.setRef(scope, ref as RefObject<HTMLElement>);

        // Always enable global scope
        if (scope === HotkeyScope.Global) {
            enableScope(scope);
            return () => {
                commandService.removeRef(scope);
            };
        }

        return () => {
            disableScope(scope);
            commandService.removeRef(scope);
        };
    }, [scope, commandService, enableScope, disableScope, ref]);

    return ref as RefObject<HTMLElement>;
};
