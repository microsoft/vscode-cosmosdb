/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useRef, useState } from 'react';

export interface UsePromptHistoryOptions {
    /** Maximum number of prompts to remember */
    maxSize?: number;
}

export interface UsePromptHistoryReturn {
    /** Navigate to the previous prompt (arrow up) */
    navigatePrevious: (currentInput: string) => string | null;
    /** Navigate to the next prompt (arrow down) */
    navigateNext: () => string | null;
    /** Add a prompt to history (call after successful submission) */
    addToHistory: (prompt: string) => void;
    /** Check if we can navigate up */
    canNavigatePrevious: () => boolean;
    /** Check if we can navigate down */
    canNavigateNext: () => boolean;
    /** Reset navigation index (call when input is modified by user) */
    resetNavigation: () => void;
}

/**
 * Hook for managing prompt history with arrow up/down navigation.
 * Stores prompts in memory and allows cycling through them.
 */
export function usePromptHistory(options: UsePromptHistoryOptions = {}): UsePromptHistoryReturn {
    const { maxSize = 50 } = options;

    // History array: most recent prompts at the beginning (index 0)
    const [history, setHistory] = useState<string[]>([]);

    // Current navigation index: -1 means not navigating (fresh input)
    // 0 = most recent, 1 = second most recent, etc.
    const navigationIndexRef = useRef<number>(-1);

    // Store the current input before navigation starts (so we can restore it)
    const savedInputRef = useRef<string>('');

    const addToHistory = useCallback(
        (prompt: string) => {
            if (!prompt.trim()) {
                return;
            }

            setHistory((prev) => {
                // Remove duplicates (keep the most recent occurrence)
                const filtered = prev.filter((p) => p !== prompt);

                // Add to the front (most recent first)
                const newHistory = [prompt, ...filtered];

                // Trim to max size
                if (newHistory.length > maxSize) {
                    return newHistory.slice(0, maxSize);
                }

                return newHistory;
            });

            // Reset navigation after adding
            navigationIndexRef.current = -1;
            savedInputRef.current = '';
        },
        [maxSize],
    );

    const navigatePrevious = useCallback(
        (currentInput: string): string | null => {
            if (history.length === 0) {
                return null;
            }

            // If starting navigation, save the current input
            if (navigationIndexRef.current === -1) {
                savedInputRef.current = currentInput;
            }

            // Move to the previous (older) prompt
            const nextIndex = navigationIndexRef.current + 1;

            if (nextIndex < history.length) {
                navigationIndexRef.current = nextIndex;
                return history[nextIndex];
            }

            // Already at the oldest prompt
            return null;
        },
        [history],
    );

    const navigateNext = useCallback((): string | null => {
        if (navigationIndexRef.current === -1) {
            // Not navigating, nothing to do
            return null;
        }

        // Move to the next (more recent) prompt
        const nextIndex = navigationIndexRef.current - 1;

        if (nextIndex >= 0) {
            navigationIndexRef.current = nextIndex;
            return history[nextIndex];
        }

        // Return to the saved input (what user was typing before navigating)
        navigationIndexRef.current = -1;
        return savedInputRef.current;
    }, [history]);

    const canNavigatePrevious = useCallback((): boolean => {
        return history.length > 0 && navigationIndexRef.current < history.length - 1;
    }, [history]);

    const canNavigateNext = useCallback((): boolean => {
        return navigationIndexRef.current > -1;
    }, []);

    const resetNavigation = useCallback(() => {
        navigationIndexRef.current = -1;
        savedInputRef.current = '';
    }, []);

    return {
        navigatePrevious,
        navigateNext,
        addToHistory,
        canNavigatePrevious,
        canNavigateNext,
        resetNavigation,
    };
}
