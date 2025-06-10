/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { isEqual } from 'es-toolkit';
import { useCallback, useEffect, useState, type RefCallback } from 'react';
import { useHotkeys, useHotkeysContext } from 'react-hotkeys-hook';
import { HotkeyCommandService } from './HotkeyCommandService';
import { HotkeyScope } from './HotkeyTypes';

export const useHotkeyScope = (scope: HotkeyScope) => {
    const commandService = HotkeyCommandService.getInstance();
    const { enableScope, disableScope } = useHotkeysContext();
    const [node, setNode] = useState<HTMLElement | null>(null);

    // Callback ref to track DOM node changes
    const ref: RefCallback<HTMLElement> = useCallback((el) => setNode(el), []);

    // Get all hotkey mappings for this scope
    const mappings = commandService.getMappingsForScope(scope);

    // Combine all keys for this scope
    const keysString = mappings.map((m) => m.key).join(', ');

    // Use react-hotkeys-hook to handle hotkeys
    // The event will always be added to the document, so we can use the scope name as a unique identifier
    useHotkeys(
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
                if (node !== null) {
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
        if (scope === HotkeyScope.Global) {
            // Always enable global scope
            enableScope(scope);
        } else if (node) {
            // For other scopes, we only enable if the node is attached
            enableScope(scope);
        } else {
            disableScope(scope);
        }

        return () => {
            disableScope(scope);
        };
    }, [scope, commandService, enableScope, disableScope, ref, node]);

    return ref;
};
