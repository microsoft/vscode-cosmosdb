/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { z } from 'zod';
import {
    getSeenTipIds,
    isAutoShowAllowed,
    isQuickStartEnabled,
    markTipsSeen,
} from '../../../utils/quickStart/quickStartStorage';
import { queryEditorProcedure, queryEditorRouter } from '../trpc';

// ─── Quick Start Router ─────────────────────────────────────────────────────
//
// Exposes the extension-host Quick Start state to the webview. The webview owns
// the tip registry (content + localization); the extension decides — using the
// extension version and user settings, both of which only the host can read —
// whether the automatic tour is allowed to fire, and records the version the
// tour last ran on. The whole tour replays from scratch on each major/minor
// upgrade. Keeping this split means new tips can be added purely on the webview
// side.

export const quickStartRouterDef = queryEditorRouter({
    /**
     * One-shot startup state for the webview:
     *  - `seenTipIds`: tips the user has already seen (kept for telemetry/back
     *    compat; the staged tour replays in full on each upgrade rather than
     *    filtering by this).
     *  - `enabled`: whether the feature is on at all (gates the replay button).
     *  - `autoShowAllowed`: whether the automatic tour may fire now (enabled +
     *    a major/minor version upgrade or a fresh install).
     */
    getStartupState: queryEditorProcedure.query(() => {
        return {
            seenTipIds: getSeenTipIds(),
            enabled: isQuickStartEnabled(),
            autoShowAllowed: isAutoShowAllowed(),
        };
    }),

    /**
     * Marks the given tip ids as seen and stamps the current extension version
     * (so the auto tour won't replay until the next major/minor upgrade).
     * Returns the updated seen list.
     */
    markTipsSeen: queryEditorProcedure
        .input(z.object({ ids: z.array(z.string()) }))
        .mutation(async ({ input }: { input: { ids: string[] } }) => {
            return markTipsSeen(input.ids);
        }),
});
