/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { markSeen, tipsVersionChanged } from './quickStartState';

/**
 * Persistence for Quick Start "seen" state, backed by the extension
 * `globalState`. Mirrors the namespacing convention used by `survey.ts`.
 *
 * Only the extension host may touch `globalState`; the webview reaches these
 * helpers through the `quickStart` tRPC router.
 */

const GLOBAL_STATE_KEY_PREFIX = 'ms-azuretools.vscode-cosmosdb.quickStart';

/** VS Code configuration that lets a user disable Quick Start entirely. */
const QUICK_START_CONFIG_SECTION = 'cosmosDB.quickStart';
const QUICK_START_ENABLED_SETTING = 'enabled';

export const QuickStartStateKeys = {
    /** `string[]` — ids of tips the user has already seen. */
    SEEN_TIP_IDS: `${GLOBAL_STATE_KEY_PREFIX}/seenTipIds`,
    /** `number` — the tip-set version the user last saw the tour on. */
    TIPS_VERSION: `${GLOBAL_STATE_KEY_PREFIX}/tipsVersion`,
} as const;

/** Returns the tip-set version recorded the last time the tour ran. */
export function getStoredTipsVersion(): number | undefined {
    return ext.context.globalState.get<number>(QuickStartStateKeys.TIPS_VERSION);
}

/**
 * Whether the Quick Start feature is enabled at all. Users (e.g. during local
 * development) can turn it off via the `cosmosDB.quickStart.enabled` setting;
 * when disabled, neither the automatic tour nor the manual replay button appear.
 */
export function isQuickStartEnabled(): boolean {
    return vscode.workspace
        .getConfiguration(QUICK_START_CONFIG_SECTION)
        .get<boolean>(QUICK_START_ENABLED_SETTING, true);
}

/**
 * Decides whether the *automatic* tour may fire for the given tip-set version,
 * resetting persisted "seen" state first when the version changed.
 *
 * The tip version (owned by the webview registry) is the switch: when it
 * differs from what we last recorded — in either direction, or on a fresh
 * install — we wipe the seen ids and stamp the new version, so the whole tour
 * replays once. The reset happens *before* the show decision, so once stamped
 * the next open with an unchanged version is a no-op. Returns whether the auto
 * tour should run now. Manual replay ignores this.
 */
export async function prepareAutoShow(tipsVersion: number): Promise<boolean> {
    if (!isQuickStartEnabled()) {
        return false;
    }
    if (!tipsVersionChanged(tipsVersion, getStoredTipsVersion())) {
        return false;
    }
    await ext.context.globalState.update(QuickStartStateKeys.SEEN_TIP_IDS, undefined);
    await ext.context.globalState.update(QuickStartStateKeys.TIPS_VERSION, tipsVersion);
    return true;
}

/** Returns the ids of all tips the user has already seen. */
export function getSeenTipIds(): string[] {
    const stored = ext.context.globalState.get<string[]>(QuickStartStateKeys.SEEN_TIP_IDS, []);
    // Guard against a corrupted/legacy value shape.
    return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string') : [];
}

/**
 * Records the given tip ids as seen (de-duplicated via the pure `markSeen`
 * helper). Returns the updated seen list. Idempotent. The tip-set version is
 * stamped by `prepareAutoShow`, not here.
 */
export async function markTipsSeen(ids: readonly string[]): Promise<string[]> {
    const updated = markSeen(getSeenTipIds(), ids);
    await ext.context.globalState.update(QuickStartStateKeys.SEEN_TIP_IDS, updated);
    return updated;
}

/**
 * Clears all persisted Quick Start state: the set of seen tip ids and the
 * recorded tip-set version. After a reset, the automatic tour behaves as if on
 * a fresh install (it will play again on the next Query Editor open). Intended
 * for testing the onboarding flow via the internal reset command.
 */
export async function resetQuickStartState(): Promise<void> {
    await ext.context.globalState.update(QuickStartStateKeys.SEEN_TIP_IDS, undefined);
    await ext.context.globalState.update(QuickStartStateKeys.TIPS_VERSION, undefined);
}
