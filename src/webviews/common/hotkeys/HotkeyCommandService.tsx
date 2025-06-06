/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type RefObject } from 'react';
import { defaultHotkeyMappings, type CommandType, type HotkeyMapping, type HotkeyScope } from './HotkeyTypes';

// Updated handler type to receive event as first parameter
type CommandHandler = (event: KeyboardEvent, ...params: unknown[]) => Promise<void> | void;

/**
 * Singleton service that manages hotkey commands across the application
 */
export class HotkeyCommandService {
    private static instance: HotkeyCommandService;

    // Store handlers by scope and command
    private commandHandlers: Map<HotkeyScope, Map<CommandType, Set<CommandHandler>>> = new Map();
    private hotkeyMappings: HotkeyMapping[] = [...defaultHotkeyMappings];
    private _hotkeyRefs: Map<HotkeyScope, RefObject<HTMLElement>> = new Map();

    // Track enabled/disabled state of handlers
    private disabledHandlers: Set<CommandHandler> = new Set();

    private constructor() {}

    public static getInstance(): HotkeyCommandService {
        if (!HotkeyCommandService.instance) {
            HotkeyCommandService.instance = new HotkeyCommandService();
        }
        return HotkeyCommandService.instance;
    }

    public get hotkeyRefs(): ReadonlyMap<HotkeyScope, RefObject<HTMLElement>> {
        return this._hotkeyRefs;
    }

    public setRef(scope: HotkeyScope, ref: RefObject<HTMLElement>): void {
        this._hotkeyRefs.set(scope, ref);
    }

    public getRef(scope: HotkeyScope): RefObject<HTMLElement> | undefined {
        return this._hotkeyRefs.get(scope);
    }

    public removeRef(scope: HotkeyScope): void {
        this._hotkeyRefs.delete(scope);
    }

    public getMappingsForScope(scope: HotkeyScope): HotkeyMapping[] {
        return this.hotkeyMappings.filter((mapping) => mapping.scope === scope);
    }

    /**
     * Registers a handler for a command action in a specific scope
     */
    public registerActionHandler(scope: HotkeyScope, command: CommandType, handler: CommandHandler): void {
        // Initialize scope map if needed
        if (!this.commandHandlers.has(scope)) {
            this.commandHandlers.set(scope, new Map());
        }

        // Get command map for this scope
        const commandMap = this.commandHandlers.get(scope)!;

        // Initialize handler set for this command if needed
        if (!commandMap.has(command)) {
            commandMap.set(command, new Set());
        }

        // Add the handler
        commandMap.get(command)!.add(handler);
    }

    /**
     * Unregisters a handler for a command action
     */
    public unregisterActionHandler(scope: HotkeyScope, command: CommandType, handler: CommandHandler): void {
        const commandMap = this.commandHandlers.get(scope);
        if (commandMap) {
            const handlers = commandMap.get(command);
            if (handlers) {
                handlers.delete(handler);
                this.disabledHandlers.delete(handler);

                // Clean up empty collections
                if (handlers.size === 0) {
                    commandMap.delete(command);
                }
                if (commandMap.size === 0) {
                    this.commandHandlers.delete(scope);
                }
            }
        }
    }

    /**
     * Sets the enabled state for a specific handler
     */
    public setHandlerEnabled(handler: CommandHandler): void {
        this.disabledHandlers.delete(handler);
    }

    /**
     * Sets the disabled state for a specific handler
     */
    public setHandlerDisabled(handler: CommandHandler): void {
        this.disabledHandlers.add(handler);
    }

    /**
     * Checks if a handler is enabled
     */
    public isHandlerEnabled(handler: CommandHandler): boolean {
        return !this.disabledHandlers.has(handler);
    }

    /**
     * Executes handlers for a command in a specific scope
     */
    public async executeCommand(
        command: CommandType,
        event: KeyboardEvent,
        scope?: HotkeyScope,
        ...params: unknown[]
    ): Promise<void> {
        if (scope) {
            // Execute only in the specified scope
            const scopeHandlers = this.commandHandlers.get(scope);
            if (scopeHandlers) {
                const handlers = scopeHandlers.get(command);
                if (handlers && handlers.size > 0) {
                    const promises = Array.from(handlers)
                        .filter((handler) => this.isHandlerEnabled(handler))
                        .map((handler) => handler(event, ...params));
                    await Promise.all(promises);
                }
            }
        } else {
            // Execute in all scopes
            const promises: Promise<void>[] = [];

            this.commandHandlers.forEach((scopeHandlers) => {
                const handlers = scopeHandlers.get(command);
                if (handlers) {
                    const scopePromises = Array.from(handlers)
                        .filter((handler) => this.isHandlerEnabled(handler))
                        .map((handler) => {
                            const result = handler(event, ...params);
                            return result instanceof Promise ? result : Promise.resolve();
                        });
                    promises.push(...scopePromises);
                }
            });

            await Promise.all(promises);
        }
    }
}
