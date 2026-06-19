/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { isEqual } from 'es-toolkit';
import { useCallback, useEffect, useMemo, useRef, type RefCallback } from 'react';
import { useHotkeys, type HotkeyCallback } from 'react-hotkeys-hook';
import { isMac } from '../../constants';
import { HotkeyCommandService } from './HotkeyCommandService';
import { type HotkeyCommand, type HotkeyMapping, type HotkeyScope } from './HotkeyTypes';

/**
 * Matches a raw `keydown` event against a hotkey key spec (e.g. `'alt+e, ctrl+shift+enter'`).
 *
 * Used by the capture-phase Alt handler below, which receives the native event directly (unlike the
 * react-hotkeys-hook bubble path, which hands us an already-parsed descriptor).
 */
const keySpecMatchesEvent = (keySpec: string, event: KeyboardEvent): boolean =>
    keySpec.split(',').some((combo) => comboMatchesEvent(combo.trim(), event));

const comboMatchesEvent = (combo: string, event: KeyboardEvent): boolean => {
    if (!combo) {
        return false;
    }

    let wantAlt = false;
    let wantCtrl = false;
    let wantShift = false;
    let wantMeta = false;
    let mainKey: string | undefined;

    for (const raw of combo.split('+')) {
        const token = raw.trim().toLowerCase();
        if (!token) {
            continue;
        }
        switch (token) {
            case 'alt':
            case 'option':
                wantAlt = true;
                break;
            case 'ctrl':
            case 'control':
                wantCtrl = true;
                break;
            case 'shift':
                wantShift = true;
                break;
            case 'meta':
            case 'cmd':
            case 'command':
            case 'win':
                wantMeta = true;
                break;
            case 'mod':
                // 'mod' is Cmd on macOS, Ctrl elsewhere (mirrors react-hotkeys-hook).
                if (isMac) {
                    wantMeta = true;
                } else {
                    wantCtrl = true;
                }
                break;
            default:
                mainKey = token;
        }
    }

    if (mainKey === undefined) {
        return false;
    }
    if (
        event.altKey !== wantAlt ||
        event.shiftKey !== wantShift ||
        event.ctrlKey !== wantCtrl ||
        event.metaKey !== wantMeta
    ) {
        return false;
    }
    return mainKeyMatchesEvent(mainKey, event);
};

const mainKeyMatchesEvent = (key: string, event: KeyboardEvent): boolean => {
    if (event.key.toLowerCase() === key) {
        return true;
    }
    // Layout-robust fallback: Alt+<letter> on non-US keyboard layouts can produce a non-Latin
    // `event.key`, but the physical `event.code` stays KeyX / DigitN. This is exactly what makes
    // Alt+E / Alt+V behave inconsistently, so we match on the physical code as a fallback.
    if (key.length === 1) {
        if (key >= 'a' && key <= 'z') {
            return event.code === `Key${key.toUpperCase()}`;
        }
        if (key >= '0' && key <= '9') {
            return event.code === `Digit${key}`;
        }
    }
    return false;
};

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
                // The shortcut is "ours", so claim the event completely and stop here.
                //
                // - preventDefault(): suppress the browser/OS default. Without it, Alt-based combos
                //   (Alt+E, Alt+D, ...) let Chromium/Electron move focus to the window menu bar.
                // - stopPropagation() + stopImmediatePropagation(): keep the keydown from bubbling
                //   any further. react-hotkeys-hook listens on `document`, and so does VS Code's
                //   keybinding forwarder; without stopping here the event reaches the host and the
                //   shortcut is also handled as a VS Code keybinding. The old implementation got this
                //   implicitly via the library `scopes` option + manual DOM-containment layer; both
                //   were removed, so we now stop propagation explicitly at this single choke point.
                //
                // Done centrally (not per handler) so it can't be forgotten when adding a command.
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();
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

    // Capture-phase handler for Alt-based shortcuts only.
    //
    // Why a separate capture listener instead of letting react-hotkeys-hook (bubble) handle these:
    // VS Code's webview injects a bubble-phase `keydown` listener on the content window that forwards
    // every keystroke to the host (see resources/.../webview/browser/pre/index.html `handleInnerKeydown`).
    // The host then turns Alt+<letter> into a window-menu mnemonic — Alt+E opens Edit, Alt+V opens View,
    // etc. That forwarding races our bubble-phase listener, so Alt shortcuts that collide with a menu
    // mnemonic are swallowed by the menu before the command can run. Handling them in the capture phase
    // (which runs before any bubble listener, including VS Code's) lets us claim the event first.
    //
    // Scoped to Alt combos on purpose: non-Alt shortcuts (Esc, Shift+Enter, Ctrl+S, …) are left to the
    // bubble path so we don't change ordering relative to Monaco / the data grid, which own those keys.
    useEffect(() => {
        const onKeyDownCapture = (event: KeyboardEvent): void => {
            if (!event.altKey) {
                return;
            }

            // Same containment rule as the library ref scoping: a node-bound scope only fires when the
            // focused element is the node or one of its descendants. The 'global' scope leaves the ref
            // unattached (boundNodeRef stays null), so it is always active.
            const node = boundNodeRef.current;
            if (node) {
                const root = node.getRootNode();
                const active = root instanceof Document || root instanceof ShadowRoot ? root.activeElement : null;
                if (active !== node && !node.contains(active)) {
                    return;
                }
            }

            const mapping = commandService.registeredHotkeys(scope).find((m) => keySpecMatchesEvent(m.key, event));
            if (!mapping) {
                return;
            }

            // Claim the event before it can reach VS Code's forwarder (see comment above).
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            void commandService.executeCommand(scope, mapping.command, event);
        };

        document.addEventListener('keydown', onKeyDownCapture, { capture: true });
        return () => document.removeEventListener('keydown', onKeyDownCapture, { capture: true });
    }, [scope, commandService]);

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
