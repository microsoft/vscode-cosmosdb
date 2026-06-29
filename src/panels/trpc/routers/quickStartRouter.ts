/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { z } from 'zod';
import {
    getSeenTipIds,
    isQuickStartEnabled,
    markTipsSeen,
    prepareAutoShow,
} from '../../../utils/quickStart/quickStartStorage';
import { queryEditorProcedure, queryEditorRouter } from '../trpc';

// ─── Quick Start Router ─────────────────────────────────────────────────────
//
// Exposes the extension-host Quick Start state to the webview. The webview owns
// the tip registry (content, localization, and the tip-set version) and tells
// the host that version at startup; the host persists which tips were seen and,
// reading the user setting, decides whether the automatic tour may fire. The
// whole tour replays from scratch whenever the tip-set version changes (in
// either direction), independently of the extension's package.json version.

export const quickStartRouterDef = queryEditorRouter({
    /**
     * One-shot startup state for the webview. Takes the current `tipsVersion`
     * from the registry; if it differs from the recorded one, the host resets
     * the seen state and stamps the new version *before* returning, so the
     * whole tour replays once. Returns:
     *  - `seenTipIds`: tips already seen (kept for telemetry/back compat).
     *  - `enabled`: whether the feature is on at all (gates the replay button).
     *  - `autoShowAllowed`: whether the automatic tour should fire now.
     */
    getStartupState: queryEditorProcedure
        .input(z.object({ tipsVersion: z.number() }))
        .mutation(async ({ input }: { input: { tipsVersion: number } }) => {
            const autoShowAllowed = await prepareAutoShow(input.tipsVersion);
            return {
                seenTipIds: getSeenTipIds(),
                enabled: isQuickStartEnabled(),
                autoShowAllowed,
            };
        }),

    /** Marks the given tip ids as seen and returns the updated seen list. */
    markTipsSeen: queryEditorProcedure
        .input(z.object({ ids: z.array(z.string()) }))
        .mutation(async ({ input }: { input: { ids: string[] } }) => {
            return markTipsSeen(input.ids);
        }),
});
