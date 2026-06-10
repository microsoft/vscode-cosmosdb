/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { isEqual } from 'es-toolkit';
import { useCallback, useMemo, useRef, type RefCallback } from 'react';
import { useHotkeys, type HotkeyCallback } from 'react-hotkeys-hook';
import { HotkeyCommandService } from './HotkeyCommandService';
import { type HotkeyCommand, type HotkeyMapping, type HotkeyScope } from './HotkeyTypes';

/**
 * Tracks the live DOM nodes each scope is bound to. A scope is meant to map to a single subtree;
 * binding the same scope to two nodes creates two independent listeners over one shared handler set
 * and double-fires when the nodes are nested. We can't prevent it outright (the binding is the
 * caller attaching our ref), so we warn when it happens.
 *
 * The check is unconditional (no build-flag gate): this runs in the webview bundle where
 * `process.env.NODE_ENV` is not reliably defined, and the bookkeeping is negligible.
 *
 * We track distinct nodes (not a counter) and evaluate on a microtask so that HMR / StrictMode
 * remounts — where the old node detaches and a new one attaches within the same commit — settle to
 * a single node before we look, instead of producing a spurious "2 nodes" warning.
 */
const scopeBoundNodes = new Map<HotkeyScope, Set<HTMLElement>>();

const bindScopeNode = (scope: HotkeyScope, node: HTMLElement): void => {
    let nodes = scopeBoundNodes.get(scope);
    if (!nodes) {
        nodes = new Set();
        scopeBoundNodes.set(scope, nodes);
    }
    nodes.add(node);

    queueMicrotask(() => {
        const live = scopeBoundNodes.get(scope);
        if (live && live.size > 1) {
            console.warn(
                `Hotkey scope "${scope}" is bound to ${live.size} DOM nodes. ` +
                    `A scope should map to a single subtree; multiple bindings share one handler set ` +
                    `and will double-fire when the nodes are nested.`,
            );
        }
    });
};

const unbindScopeNode = (scope: HotkeyScope, node: HTMLElement): void => {
    const nodes = scopeBoundNodes.get(scope);
    if (!nodes) {
        return;
    }
    nodes.delete(node);
    if (nodes.size === 0) {
        scopeBoundNodes.delete(scope);
    }
};

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
    const hotkeysRef = useHotkeys(keysString, eventHandler, {
        enableOnFormTags: ['textarea', 'input' /*, 'textbox'*/],
        enableOnContentEditable: true,
    });

    // Forward the library ref, and warn if the same scope ends up bound to more than one node.
    const boundNodeRef = useRef<HTMLElement | null>(null);
    return useCallback<RefCallback<HTMLElement>>(
        (el) => {
            hotkeysRef(el);

            if (el) {
                boundNodeRef.current = el;
                bindScopeNode(scope, el);
            } else if (boundNodeRef.current) {
                unbindScopeNode(scope, boundNodeRef.current);
                boundNodeRef.current = null;
            }
        },
        [hotkeysRef, scope],
    );
};
