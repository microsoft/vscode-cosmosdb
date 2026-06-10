/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isMac } from '../../constants';
import { type HotkeyCommand, type HotkeyMapping, type HotkeyScope } from './HotkeyTypes';

export type CommandHandler = (event: KeyboardEvent, ...params: unknown[]) => Promise<void> | void;

/**
 * Singleton registry that maps hotkey scopes to their static key/command definitions and to the
 * runtime command handlers contributed by components.
 *
 * Scoping (i.e. "which DOM subtree is a shortcut active in") is intentionally NOT handled here:
 * `useHotkeyScope` delegates that to react-hotkeys-hook's ref-based scoping. This service only
 * answers two questions:
 *   1. Which command does a pressed key map to in a given scope? (routing + tooltip display)
 *   2. Which handlers should run for a command? (enabled handlers only)
 */
export class HotkeyCommandService<Scope extends HotkeyScope, Command extends HotkeyCommand> {
    private static instance: HotkeyCommandService<string, string>;

    /** Static key/command mappings per scope (sourced from module-level constants). */
    private scopes: Map<Scope, readonly HotkeyMapping<Command>[]> = new Map();

    /** Runtime handlers per scope/command. */
    private commandHandlers: Map<Scope, Map<Command, Set<CommandHandler>>> = new Map();

    /** Handlers that are currently disabled. Keyed by function identity, auto-cleaned by GC. */
    private disabledHandlers: WeakSet<CommandHandler> = new WeakSet();

    private constructor() {}

    public static getInstance<S extends HotkeyScope, C extends HotkeyCommand>(): HotkeyCommandService<S, C> {
        if (!HotkeyCommandService.instance) {
            HotkeyCommandService.instance = new HotkeyCommandService<S, C>();
        }
        return HotkeyCommandService.instance as HotkeyCommandService<S, C>;
    }

    /**
     * Registers (or refreshes) the static mappings for a scope.
     *
     * Idempotent by design: the `hotkeys` argument is a stable module-level constant, so re-running
     * with the same reference is a no-op. This makes it safe to call on every render and across
     * HMR / StrictMode remounts without any "already registered" bookkeeping or unregister races.
     */
    public registerScope(scope: Scope, hotkeys: readonly HotkeyMapping<Command>[] = []): void {
        if (this.scopes.get(scope) === hotkeys) {
            return;
        }
        this.scopes.set(scope, hotkeys);
        if (!this.commandHandlers.has(scope)) {
            this.commandHandlers.set(scope, new Map());
        }
    }

    /**
     * Gets all registered hotkey mappings for a specific scope.
     */
    public registeredHotkeys(scope: Scope): readonly HotkeyMapping<Command>[] {
        return this.scopes.get(scope) ?? [];
    }

    /**
     * Registers a handler for a command in a specific scope.
     */
    public registerActionHandler(scope: Scope, command: Command, handler: CommandHandler): void {
        let commandMap = this.commandHandlers.get(scope);
        if (!commandMap) {
            commandMap = new Map();
            this.commandHandlers.set(scope, commandMap);
        }

        let handlers = commandMap.get(command);
        if (!handlers) {
            handlers = new Set();
            commandMap.set(command, handlers);
        }

        handlers.add(handler);
    }

    /**
     * Unregisters a handler for a command.
     */
    public unregisterActionHandler(scope: Scope, command: Command, handler: CommandHandler): void {
        this.commandHandlers.get(scope)?.get(command)?.delete(handler);
        this.disabledHandlers.delete(handler);
    }

    /**
     * Enables a previously disabled handler.
     */
    public enableHandler(handler: CommandHandler): void {
        this.disabledHandlers.delete(handler);
    }

    /**
     * Disables a handler so it is skipped during command execution.
     */
    public disableHandler(handler: CommandHandler): void {
        this.disabledHandlers.add(handler);
    }

    public getHotkeyMapping(scope: Scope, command: Command): HotkeyMapping<Command> | undefined {
        return this.scopes.get(scope)?.find((hk) => hk.command === command);
    }

    public getShortcutDisplay(scope: Scope, command: Command): string | undefined {
        const mapping = this.getHotkeyMapping(scope, command);
        if (mapping) {
            return mapping.shortcutDisplay[isMac ? 'mac' : 'windows'] || mapping.shortcutDisplay.windows;
        }
        return undefined; // No mapping found for the command in the scope
    }

    /**
     * Executes all enabled handlers for a command in a specific scope.
     */
    public async executeCommand(
        scope: Scope,
        command: Command,
        event: KeyboardEvent,
        ...params: unknown[]
    ): Promise<void> {
        const handlers = this.commandHandlers.get(scope)?.get(command);
        if (!handlers || handlers.size === 0) {
            return;
        }

        await Promise.all(
            Array.from(handlers)
                .filter((handler) => !this.disabledHandlers.has(handler))
                .map(async (handler) => handler(event, ...params)),
        );
    }
}
