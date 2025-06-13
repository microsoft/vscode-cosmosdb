/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useEffect, useRef } from 'react';
import { HotkeyCommandService, type CommandHandler } from './HotkeyCommandService';
import { type HotkeyCommand, type HotkeyScope } from './HotkeyTypes';

export interface UseCommandHotkeyOptions {
    disabled?: boolean;
}

export const useCommandHotkey = <Scope extends HotkeyScope, Command extends HotkeyCommand, T extends unknown[] = []>(
    scope: Scope,
    command: Command,
    handler: CommandHandler,
    options?: UseCommandHotkeyOptions,
): void => {
    const commandService = HotkeyCommandService.getInstance<Scope, Command>();
    const handlerRef = useRef<CommandHandler>(handler);

    handlerRef.current = handler;

    // Create a stable wrapper function that always calls the current handler
    const stableWrapper = useCallback((event: KeyboardEvent, ...params: T) => {
        return handlerRef?.current(event, ...params);
    }, []);

    // Register/unregister the stable wrapper
    useEffect(() => {
        commandService.registerActionHandler(scope, command, stableWrapper);

        return () => {
            commandService.unregisterActionHandler(scope, command, stableWrapper);
        };
    }, [commandService, scope, command, stableWrapper]);

    // Handle enabled state
    useEffect(() => {
        if (options?.disabled === true) {
            commandService.disableHandler(scope, command, stableWrapper);
        } else {
            commandService.enableHandler(scope, command, stableWrapper);
        }
    }, [commandService, scope, command, stableWrapper, options?.disabled]);
};
