/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useEffect, useRef, type DependencyList } from 'react';
import { HotkeyCommandService } from './HotkeyCommandService';
import { type CommandType, type HotkeyScope } from './HotkeyTypes';

export interface UseCommandHotkeyOptions {
    disabled?: boolean;
}

export const useCommandHotkey = <T extends unknown[]>(
    scope: HotkeyScope,
    command: CommandType,
    handler: (event: KeyboardEvent, ...params: T) => Promise<void> | void,
    dependencies?: DependencyList | UseCommandHotkeyOptions,
    options?: UseCommandHotkeyOptions,
): void => {
    const commandService = HotkeyCommandService.getInstance();
    if (dependencies && !Array.isArray(dependencies) && typeof dependencies === 'object') {
        // If dependencies is an object, treat it as options
        options = dependencies as UseCommandHotkeyOptions;
        dependencies = undefined; // Clear dependencies to avoid confusion
    }

    // Memoize the handler if dependencies are provided
    const isMemoized = dependencies && dependencies.length > 0;
    const memoizedHandler = useCallback(handler, dependencies ?? []);
    const handlerRef = useRef(memoizedHandler);

    if (isMemoized) {
        // Update the ref to the latest memoized handler
        handlerRef.current = memoizedHandler;
    } else {
        // If no dependencies, use the original handler directly
        handlerRef.current = handler;
    }

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
            commandService.setHandlerDisabled(stableWrapper);
        } else {
            commandService.setHandlerEnabled(stableWrapper);
        }
    }, [commandService, stableWrapper, options?.disabled]);
};
