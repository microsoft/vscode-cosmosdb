/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { isMac } from '../../constants';
import { type HotkeyCommand, type HotkeyMapping, type HotkeyScope } from './HotkeyTypes';

export type CommandHandler = (event: KeyboardEvent, ...params: unknown[]) => Promise<void> | void;

/**
 * Singleton service that manages hotkey commands across the application
 */
export class HotkeyCommandService<Scope extends HotkeyScope, Command extends HotkeyCommand> {
    private static instance: HotkeyCommandService<string, string>;

    private hotkeyRefs: Map<HotkeyScope, HTMLElement> = new Map();

    // Registered scopes and their supported commands
    private scopes: Map<Scope, Set<HotkeyMapping<Command>>> = new Map();

    // Store handlers by scope and command
    private commandHandlers: Map<Scope, Map<Command, Set<CommandHandler>>> = new Map();

    // Track disabled handlers by scope and command
    private disabledHandlers: Map<Scope, Map<Command, Set<CommandHandler>>> = new Map();

    private constructor() {}

    public static getInstance<S extends HotkeyScope, C extends HotkeyCommand>(): HotkeyCommandService<S, C> {
        if (!HotkeyCommandService.instance) {
            HotkeyCommandService.instance = new HotkeyCommandService<S, C>();
        }
        return HotkeyCommandService.instance as HotkeyCommandService<S, C>;
    }

    /**
     * Sets a DOM node reference for a specific scope
     * @throws Error if the scope is already bound or if trying to bind 'global' scope
     */
    public setRef(scope: HotkeyScope, ref?: HTMLElement | null): void {
        if (ref === undefined || ref === null) {
            this.hotkeyRefs.delete(scope);
            return;
        } else if (this.hotkeyRefs.has(scope)) {
            throw new Error(
                l10n.t(`Scope '{name}' is already bound to a DOM node. Each scope can only be bound once.`, {
                    name: scope,
                }),
            );
        } else if (scope === 'global') {
            throw new Error(
                l10n.t(
                    'The "global" scope cannot be bound to a DOM node. It is automatically applied to the entire document.',
                ),
            );
        } else {
            this.hotkeyRefs.set(scope, ref);
        }
    }

    /**
     * Gets the DOM node reference for a specific scope
     * @returns The HTMLElement bound to the scope, or undefined if not set
     */
    public getRef(scope: HotkeyScope): HTMLElement | undefined {
        return this.hotkeyRefs.get(scope);
    }

    /**
     * Removes the DOM node reference for a specific scope
     * @throws Error if the scope is 'global'
     */
    public removeRef(scope: HotkeyScope): void {
        this.hotkeyRefs.delete(scope);
    }

    /**
     * Gets all registered hotkeys for a specific scope
     * @returns A Set of HotkeyMapping for the given scope
     */
    public registeredHotkeys(scope: Scope): Set<HotkeyMapping<Command>> {
        return this.scopes.get(scope) || new Set();
    }

    /**
     * Registers a new scope with its supported commands
     */
    public registerScope(scope: Scope, hotkeys: HotkeyMapping<Command>[] = []): void {
        // Initialize scope set if needed
        if (!this.scopes.has(scope)) {
            this.scopes.set(scope, new Set());
            this.commandHandlers.set(scope, new Map());
            this.disabledHandlers.set(scope, new Map());
        }

        // Add hotkeys to the scope
        const scopeHotkeys = this.scopes.get(scope)!;
        const existingHotkeys = Array.from(scopeHotkeys).map((hk) => hk.key);
        const existingCommands = Array.from(scopeHotkeys).map((hk) => hk.command);

        hotkeys.forEach((hotkey) => {
            if (existingHotkeys.includes(hotkey.key)) {
                console.warn(`Hotkey ${hotkey.key} is already registered in scope ${scope}`);
                return;
            }
            if (existingCommands.includes(hotkey.command)) {
                console.warn(`Command ${hotkey.command} is already registered in scope ${scope}`);
                return;
            }

            // Add the hotkey mapping
            scopeHotkeys.add(hotkey);

            // Initialize command handlers for this hotkey
            if (!this.commandHandlers.get(scope)!.has(hotkey.command)) {
                this.commandHandlers.get(scope)!.set(hotkey.command, new Set());
            }
        });
    }

    /**
     * Unregisters all handlers for a specific scope
     */
    public unregisterScope(scope: Scope, hotkeys?: HotkeyMapping<Command>[]): void {
        if (hotkeys) {
            // Remove specific hotkeys from the scope
            const scopeHotkeys = this.scopes.get(scope);
            if (scopeHotkeys) {
                hotkeys.forEach((hotkey) => {
                    scopeHotkeys.delete(hotkey);
                });

                // Clean up if empty
                if (scopeHotkeys.size === 0) {
                    this.scopes.delete(scope);
                }
            }

            // Also remove all command handlers for this scope
            const commandMap = this.commandHandlers.get(scope);
            if (commandMap) {
                hotkeys.forEach((hotkey) => {
                    if (commandMap.has(hotkey.command)) {
                        commandMap.delete(hotkey.command);
                    }
                });

                // Clean up empty command map
                if (commandMap.size === 0) {
                    this.commandHandlers.delete(scope);
                }
            }

            // Also remove all disabled handlers for this scope
            const disabledCommandMap = this.disabledHandlers.get(scope);
            if (disabledCommandMap) {
                hotkeys.forEach((hotkey) => {
                    if (disabledCommandMap.has(hotkey.command)) {
                        disabledCommandMap.delete(hotkey.command);
                    }
                });

                // Clean up empty disabled command map
                if (disabledCommandMap.size === 0) {
                    this.disabledHandlers.delete(scope);
                }
            }

            // Clean up any associated DOM node
            this.removeRef(scope);
        } else {
            // Remove all hotkeys for this scope
            this.scopes.delete(scope);
            // Also remove all command handlers for this scope
            this.commandHandlers.delete(scope);
            // Also remove all disabled handlers for this scope
            this.disabledHandlers.delete(scope);
            // Clean up any associated DOM node
            this.removeRef(scope);
        }
    }

    /**
     * Registers a handler for a command action in a specific scope
     */
    public registerActionHandler(scope: Scope, command: Command, handler: CommandHandler): void {
        // Initialize scope map if needed
        if (!this.commandHandlers.has(scope)) {
            throw new Error(
                l10n.t('Scope {name} is not registered. Please register the scope before adding handlers.', {
                    name: scope,
                }),
            );
        }

        // Get command map for this scope
        const commandMap = this.commandHandlers.get(scope)!;

        if (!commandMap.has(command)) {
            throw new Error(l10n.t('Command {name} is not registered in scope {scope}.', { name: command, scope }));
        }

        // Add the handler
        commandMap.get(command)!.add(handler);
    }

    /**
     * Unregisters a handler for a command action
     */
    public unregisterActionHandler(scope: Scope, command: Command, handler: CommandHandler): void {
        // Remove from commandHandlers
        const commandMap = this.commandHandlers.get(scope);
        if (commandMap) {
            commandMap.get(command)?.delete(handler);
        }

        // Remove from disabledHandlers
        const disabledCommandMap = this.disabledHandlers.get(scope);
        if (disabledCommandMap) {
            disabledCommandMap.get(command)?.delete(handler);
        }
    }

    /**
     * Enables a specific handler for a command
     */
    public enableHandler(scope: Scope, command: Command, handler: CommandHandler): void {
        const disabledCommandMap = this.disabledHandlers.get(scope);
        if (disabledCommandMap) {
            disabledCommandMap.get(command)?.delete(handler);
        }
    }

    /**
     * Disables a specific handler for a command
     */
    public disableHandler(scope: Scope, command: Command, handler: CommandHandler): void {
        // Verify the handler exists
        const commandMap = this.commandHandlers.get(scope);
        if (!commandMap) {
            console.warn(l10n.t('Scope {scope} is not registered.', { scope }));
            return; // Scope not registered
        }

        const handlers = commandMap.get(command);
        if (!handlers || !handlers.has(handler)) {
            console.warn(
                l10n.t('Handler for command {command} in scope {scope} is not registered.', {
                    command,
                    scope,
                }),
            );
            return; // Handler not registered
        }

        // Initialize disabled maps if needed
        if (!this.disabledHandlers.has(scope)) {
            this.disabledHandlers.set(scope, new Map());
        }

        const disabledCommandMap = this.disabledHandlers.get(scope)!;
        if (!disabledCommandMap.has(command)) {
            disabledCommandMap.set(command, new Set());
        }

        // Add to disabled handlers
        disabledCommandMap.get(command)!.add(handler);
    }

    /**
     * Enables all handlers for a command
     */
    public enableCommand(scope: Scope, command: Command): void {
        this.disabledHandlers.get(scope)?.delete(command);
    }

    /**
     * Disables all handlers for a command
     */
    public disableCommand(scope: Scope, command: Command): void {
        const commandMap = this.commandHandlers.get(scope);
        if (!commandMap) {
            console.warn(l10n.t('Scope {scope} is not registered.', { scope }));
            return; // Scope not registered
        }

        const handlers = commandMap.get(command);
        if (!handlers) {
            console.warn(
                l10n.t('Command {command} is not registered in scope {scope}.', {
                    command,
                    scope,
                }),
            );
            return; // Command not registered
        }

        if (handlers.size === 0) return;

        // Initialize disabled maps if needed
        if (!this.disabledHandlers.has(scope)) {
            this.disabledHandlers.set(scope, new Map());
        }

        const disabledCommandMap = this.disabledHandlers.get(scope)!;
        disabledCommandMap.set(command, new Set(handlers));
    }

    /**
     * Checks if a handler is enabled
     */
    public isHandlerEnabled(scope: Scope, command: Command, handler: CommandHandler): boolean {
        const disabledCommandMap = this.disabledHandlers.get(scope);
        if (!disabledCommandMap) {
            return true;
        }

        const disabledHandlers = disabledCommandMap.get(command);
        if (!disabledHandlers) {
            return true;
        }

        return !disabledHandlers.has(handler);
    }

    public getHotkeyMapping(scope: Scope, command: Command): HotkeyMapping<Command> | undefined {
        const scopeHotkeys = this.scopes.get(scope);
        if (!scopeHotkeys) {
            return undefined; // Scope not registered
        }

        return Array.from(scopeHotkeys).find((hk) => hk.command === command);
    }

    public getShortcutDisplay(scope: Scope, command: Command): string | undefined {
        const mapping = this.getHotkeyMapping(scope, command);
        if (mapping) {
            return mapping.shortcutDisplay[isMac ? 'mac' : 'windows'] || mapping.shortcutDisplay.windows;
        }
        return undefined; // No mapping found for the command in the scope
    }

    /**
     * Executes handlers for a command in a specific scope
     */
    public async executeCommand(
        scope: Scope,
        command: Command,
        event: KeyboardEvent,
        ...params: unknown[]
    ): Promise<void> {
        const scopeHandlers = this.commandHandlers.get(scope);
        if (scopeHandlers) {
            const handlers = scopeHandlers.get(command);
            if (handlers && handlers.size > 0) {
                const promises = Array.from(handlers)
                    .filter((handler) => this.isHandlerEnabled(scope, command, handler))
                    .map(async (handler) => handler(event, ...params));
                await Promise.all(promises);
            }
        }
    }
}
