/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { type CommandHandler, HotkeyCommandService } from './HotkeyCommandService';
import { type HotkeyMapping } from './HotkeyTypes';

type Scope = 'global' | 'queryEditor' | 'resultPanel';
type Command = 'Save' | 'Run' | 'Copy';

// A dummy event is enough: the service treats it as an opaque value it forwards to handlers.
const event = {} as KeyboardEvent;

function getService(): HotkeyCommandService<Scope, Command> {
    return HotkeyCommandService.getInstance<Scope, Command>();
}

describe('HotkeyCommandService', () => {
    beforeEach(() => {
        // The service is a module-level singleton; reset the static instance so each test starts
        // from a clean registry without leaking handlers/scopes across tests.
        (HotkeyCommandService as unknown as { instance?: unknown }).instance = undefined;
    });

    describe('getInstance', () => {
        it('returns the same singleton instance', () => {
            expect(getService()).toBe(getService());
        });
    });

    describe('registerScope / registeredHotkeys', () => {
        it('stores and returns the mappings for a scope', () => {
            const service = getService();
            const hotkeys: HotkeyMapping<Command>[] = [
                { key: 'mod+s', command: 'Save', shortcutDisplay: { windows: 'Ctrl+S', mac: '⌘S' } },
            ];

            service.registerScope('queryEditor', hotkeys);

            expect(service.registeredHotkeys('queryEditor')).toBe(hotkeys);
        });

        it('returns an empty array for an unknown scope', () => {
            expect(getService().registeredHotkeys('global')).toEqual([]);
        });

        it('replaces mappings when called with a different array reference', () => {
            const service = getService();
            const first: HotkeyMapping<Command>[] = [
                { key: 'mod+s', command: 'Save', shortcutDisplay: { windows: 'Ctrl+S', mac: '⌘S' } },
            ];
            const second: HotkeyMapping<Command>[] = [
                { key: 'mod+enter', command: 'Run', shortcutDisplay: { windows: 'Ctrl+Enter', mac: '⌘↵' } },
            ];

            service.registerScope('queryEditor', first);
            service.registerScope('queryEditor', second);

            expect(service.registeredHotkeys('queryEditor')).toBe(second);
        });

        it('is idempotent and preserves handlers when re-registering the same array reference', async () => {
            const service = getService();
            const hotkeys: HotkeyMapping<Command>[] = [
                { key: 'mod+s', command: 'Save', shortcutDisplay: { windows: 'Ctrl+S', mac: '⌘S' } },
            ];
            const handler = vi.fn();

            service.registerScope('queryEditor', hotkeys);
            service.registerActionHandler('queryEditor', 'Save', handler);

            // Re-registering with the same reference (as happens on every render / HMR remount) must
            // not wipe the already-registered handler.
            service.registerScope('queryEditor', hotkeys);
            await service.executeCommand('queryEditor', 'Save', event);

            expect(handler).toHaveBeenCalledTimes(1);
        });
    });

    describe('executeCommand', () => {
        it('invokes the registered handler with the event and extra params', async () => {
            const service = getService();
            const handler = vi.fn();
            service.registerActionHandler('queryEditor', 'Save', handler);

            await service.executeCommand('queryEditor', 'Save', event, 'a', 1);

            expect(handler).toHaveBeenCalledTimes(1);
            expect(handler).toHaveBeenCalledWith(event, 'a', 1);
        });

        it('invokes every handler registered for the same command', async () => {
            const service = getService();
            const first = vi.fn();
            const second = vi.fn();
            service.registerActionHandler('queryEditor', 'Save', first);
            service.registerActionHandler('queryEditor', 'Save', second);

            await service.executeCommand('queryEditor', 'Save', event);

            expect(first).toHaveBeenCalledTimes(1);
            expect(second).toHaveBeenCalledTimes(1);
        });

        it('does not run handlers from a different scope or command', async () => {
            const service = getService();
            const editorSave = vi.fn();
            const panelSave = vi.fn();
            const editorRun = vi.fn();
            service.registerActionHandler('queryEditor', 'Save', editorSave);
            service.registerActionHandler('resultPanel', 'Save', panelSave);
            service.registerActionHandler('queryEditor', 'Run', editorRun);

            await service.executeCommand('queryEditor', 'Save', event);

            expect(editorSave).toHaveBeenCalledTimes(1);
            expect(panelSave).not.toHaveBeenCalled();
            expect(editorRun).not.toHaveBeenCalled();
        });

        it('resolves without error when no handlers are registered', async () => {
            await expect(getService().executeCommand('global', 'Save', event)).resolves.toBeUndefined();
        });

        it('awaits async handlers', async () => {
            const service = getService();
            const order: string[] = [];
            const handler: CommandHandler = async () => {
                await Promise.resolve();
                order.push('done');
            };
            service.registerActionHandler('queryEditor', 'Save', handler);

            await service.executeCommand('queryEditor', 'Save', event);

            expect(order).toEqual(['done']);
        });
    });

    describe('unregisterActionHandler', () => {
        it('stops a handler from running after it is unregistered', async () => {
            const service = getService();
            const handler = vi.fn();
            service.registerActionHandler('queryEditor', 'Save', handler);
            service.unregisterActionHandler('queryEditor', 'Save', handler);

            await service.executeCommand('queryEditor', 'Save', event);

            expect(handler).not.toHaveBeenCalled();
        });
    });

    describe('enable / disable handler', () => {
        it('skips a disabled handler and runs it again after re-enabling', async () => {
            const service = getService();
            const handler = vi.fn();
            service.registerActionHandler('queryEditor', 'Save', handler);

            service.disableHandler(handler);
            await service.executeCommand('queryEditor', 'Save', event);
            expect(handler).not.toHaveBeenCalled();

            service.enableHandler(handler);
            await service.executeCommand('queryEditor', 'Save', event);
            expect(handler).toHaveBeenCalledTimes(1);
        });

        it('only disables the targeted handler, not its siblings', async () => {
            const service = getService();
            const disabled = vi.fn();
            const enabled = vi.fn();
            service.registerActionHandler('queryEditor', 'Save', disabled);
            service.registerActionHandler('queryEditor', 'Save', enabled);

            service.disableHandler(disabled);
            await service.executeCommand('queryEditor', 'Save', event);

            expect(disabled).not.toHaveBeenCalled();
            expect(enabled).toHaveBeenCalledTimes(1);
        });

        it('clears the disabled flag when a handler is unregistered', async () => {
            const service = getService();
            const handler = vi.fn();

            service.registerActionHandler('queryEditor', 'Save', handler);
            service.disableHandler(handler);
            service.unregisterActionHandler('queryEditor', 'Save', handler);

            // Re-registering the same function must start enabled (no stale disabled state).
            service.registerActionHandler('queryEditor', 'Save', handler);
            await service.executeCommand('queryEditor', 'Save', event);

            expect(handler).toHaveBeenCalledTimes(1);
        });
    });
});
