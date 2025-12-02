/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { isEqual } from 'es-toolkit';
import { useCallback, useEffect, useRef, useState, type RefCallback } from 'react';
import { useHotkeys, type HotkeyCallback } from 'react-hotkeys-hook';
import { HotkeyCommandService } from './HotkeyCommandService';
import { type HotkeyCommand, type HotkeyMapping, type HotkeyScope } from './HotkeyTypes';

export const useHotkeyScope = <Scope extends HotkeyScope, Command extends HotkeyCommand>(
    scope: Scope,
    hotkeys: HotkeyMapping<Command>[],
) => {
    const commandService = HotkeyCommandService.getInstance<Scope, Command>();
    const [isRegistered, setIsRegistered] = useState(false);
    const hotkeysRef = useRef<HotkeyMapping<Command>[]>([]);
    const ref: RefCallback<HTMLElement> = useCallback(
        (el) => void (el && !commandService.getRef(scope) && commandService.setRef(scope, el)),
        [commandService, scope],
    );

    if (!isRegistered) {
        // Register the scope with the command service if not already registered
        commandService.registerScope(scope, hotkeys);
        // TODO: investigate how to avoid this disable
        // eslint-disable-next-line react-hooks/refs
        hotkeysRef.current = hotkeys;
        setIsRegistered(true);
    }

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

            const registeredHotkeys = Array.from(commandService.registeredHotkeys(scope));
            const mapping = registeredHotkeys.find((m) =>
                m.key
                    .split(', ')
                    .map((k) => k.split('+').sort())
                    .some((k) => isEqual(k, pressedKeys)),
            );

            if (mapping) {
                const node = commandService.getRef(scope);
                if (node) {
                    // Since the event is now attached to the node, the active element can never be inside the node.
                    // The hotkey only triggers if the node is/has the active element.
                    // This is a problem since focused subcomponents won't trigger the hotkey.
                    const rootNode = node.getRootNode();

                    if (
                        (rootNode instanceof Document || rootNode instanceof ShadowRoot) &&
                        rootNode.activeElement !== node &&
                        !node.contains(rootNode.activeElement)
                    ) {
                        // Just ignore the event if the active element is not within the scope node
                        return;
                    }
                }
                // Pass the event to allow handlers to control propagation
                void commandService.executeCommand(scope, mapping.command, event);
            }
        },
        [scope, commandService],
    );

    useEffect(() => {
        // Unregister any previous hotkeys for this scope
        return () => {
            // Sometimes might be a race condition when the old component is not unmounted before the new one is mounted
            // Therefore we rely on useHotkeyCommand to handle the unregistration of action,
            // then useHotkeys will remove the keyboard event listener.
            // Race condition can happen in the following scenario (i.e. hot reloading of the component):
            // 1. Old component is unmounting
            // 2. New component is mounting
            // 3. New component registers the same scope
            // 4. Old component tries to unregister the scope, but it is already registered by the new component
            // 5. Old component totally wipes out the hotkeys for the scope, which is not what we want
            // commandService.unregisterScope(scope, hotkeysRef.current);

            // Clear the hotkeys reference
            hotkeysRef.current = [];
            // Reset the registration state
            setIsRegistered(false);
        };
    }, [scope, hotkeys, commandService]);

    // Combine all keys for this scope
    const keysString = hotkeys
        .map((m) => m.key)
        .sort()
        .join(', ');
    // Use react-hotkeys-hook to handle hotkeys
    // The event will always be added to the document, so we can use the scope name as a unique identifier
    useHotkeys(keysString, eventHandler, {
        enableOnFormTags: ['textarea', 'input', 'textbox'],
        enableOnContentEditable: true,
        scopes: scope, // Use the scope name as the scope identifier
    });

    return ref;
};
