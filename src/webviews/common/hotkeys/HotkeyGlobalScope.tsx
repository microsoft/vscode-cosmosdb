/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { HotkeyScope } from './HotkeyTypes';
import { useHotkeyScope } from './useHotkeyScope';

export const HotkeyGlobalScope = () => {
    // This component is used to set up the global hotkey scope for the entire webview.
    // It does not render anything but ensures that hotkeys are registered globally.

    // Set up the global hotkey scope
    useHotkeyScope(HotkeyScope.Global);

    return null; // No UI elements to render
};
