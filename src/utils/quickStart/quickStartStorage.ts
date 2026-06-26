/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { isMajorOrMinorUpgrade, markSeen } from './quickStartState';

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
    /** `string` — extension version recorded the last time tips were marked seen. */
    LAST_VERSION: `${GLOBAL_STATE_KEY_PREFIX}/lastVersion`,
} as const;

/** The current extension version, as declared in `package.json`. */
function getCurrentVersion(): string {
    return (ext.context.extension.packageJSON as { version: string }).version;
}

/** Returns the extension version recorded the last time tips were marked seen. */
export function getLastVersion(): string | undefined {
    return ext.context.globalState.get<string>(QuickStartStateKeys.LAST_VERSION);
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
 * Whether the *automatic* tour is allowed to fire right now: the feature must be
 * enabled and the current version must be a major/minor upgrade over the last
 * version the user saw tips on (or a fresh install). Manual replay ignores this.
 */
export function isAutoShowAllowed(): boolean {
    return isQuickStartEnabled() && isMajorOrMinorUpgrade(getCurrentVersion(), getLastVersion());
}

/** Returns the ids of all tips the user has already seen. */
export function getSeenTipIds(): string[] {
    const stored = ext.context.globalState.get<string[]>(QuickStartStateKeys.SEEN_TIP_IDS, []);
    // Guard against a corrupted/legacy value shape.
    return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string') : [];
}

/**
 * Records the given tip ids as seen (de-duplicated via the pure `markSeen`
 * helper) and stamps the current extension version. Returns the updated seen
 * list. Idempotent.
 */
export async function markTipsSeen(ids: readonly string[]): Promise<string[]> {
    const updated = markSeen(getSeenTipIds(), ids);
    await ext.context.globalState.update(QuickStartStateKeys.SEEN_TIP_IDS, updated);
    await ext.context.globalState.update(QuickStartStateKeys.LAST_VERSION, getCurrentVersion());
    return updated;
}

/**
 * Clears all persisted Quick Start state: the set of seen tip ids and the
 * recorded last version. After a reset, the automatic tour behaves as if on a
 * fresh install (it will play again on the next Query Editor open). Intended for
 * testing the onboarding flow via the internal reset command.
 */
export async function resetQuickStartState(): Promise<void> {
    await ext.context.globalState.update(QuickStartStateKeys.SEEN_TIP_IDS, undefined);
    await ext.context.globalState.update(QuickStartStateKeys.LAST_VERSION, undefined);
}
