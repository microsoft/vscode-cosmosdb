/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContext, useContext } from 'react';

/**
 * Whether the Quick Start feature is enabled for this session. Mirrors the
 * `cosmosDB.quickStart.enabled` setting read on the extension host. When
 * disabled, both the automatic tour and the manual replay button are hidden.
 *
 * Defaults to `true` until the startup state has been fetched so the toolbar
 * does not flicker; the provider narrows it to the real value once known.
 */
export const QuickStartEnabledContext = createContext<boolean>(true);

export function useQuickStartEnabled(): boolean {
    return useContext(QuickStartEnabledContext);
}
