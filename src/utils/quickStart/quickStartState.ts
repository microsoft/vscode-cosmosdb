/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Pure Quick Start "seen state" logic.
 *
 * This module has NO dependency on VS Code, the DOM, React, or any persistence
 * mechanism. It is the single source of truth for "which tips should the user
 * see next" and is unit-tested in isolation (see `quickStartState.test.ts`).
 *
 * Whether the *automatic* tour fires is gated on the tip-set version, not the
 * extension version (see `tipsVersionChanged`): the whole tour replays from
 * scratch only when the authored tip version changes (in either direction) or
 * on a fresh install. Routine extension releases never re-trigger it. The user
 * can still replay manually at any time.
 */

/** Minimal shape the pure logic needs from a tip. */
export interface TipLike {
    id: string;
    group?: string;
    order?: number;
}

/**
 * Returns the tips the user has not yet seen, in display order (see `sortTips`).
 *
 * @param allTips    The full, current tip registry.
 * @param seenIds    Ids the user has already seen (any order; duplicates ok).
 */
export function getPendingTips<T extends TipLike>(allTips: readonly T[], seenIds: readonly string[]): T[] {
    const seen = new Set(seenIds);
    const pending = allTips.filter((tip) => !seen.has(tip.id));
    return sortTips(pending);
}

/**
 * Stable sort: tips with an explicit `order` come first (ascending), then tips
 * without `order` in their original relative order. Index is used as a
 * tiebreaker so the result is deterministic and the input is never mutated.
 */
export function sortTips<T extends TipLike>(tips: readonly T[]): T[] {
    return tips
        .map((tip, index) => ({ tip, index }))
        .sort((a, b) => {
            const ao = a.tip.order;
            const bo = b.tip.order;
            if (ao !== undefined && bo !== undefined) {
                return ao - bo || a.index - b.index;
            }
            if (ao !== undefined) {
                return -1;
            }
            if (bo !== undefined) {
                return 1;
            }
            return a.index - b.index;
        })
        .map((entry) => entry.tip);
}

/**
 * Returns the tips belonging to a single flow segment, in display order.
 *
 * @param allTips  The full, current tip registry.
 * @param group    A group id, or `null` for the "ungrouped" intro tips (tips
 *                 with no `group`).
 */
export function getTipsInSegment<T extends TipLike>(allTips: readonly T[], group: string | null): T[] {
    const inSegment = allTips.filter((tip) => (group === null ? tip.group === undefined : tip.group === group));
    return sortTips(inSegment);
}

/**
 * Merges newly-seen ids into the existing set, de-duplicated. The result is a
 * new array (the inputs are never mutated). Idempotent: marking an already-seen
 * id again is a no-op.
 *
 * Order of first appearance is preserved (existing ids first, then new ones) so
 * the persisted value stays stable across calls.
 */
export function markSeen(seenIds: readonly string[], newlySeenIds: readonly string[]): string[] {
    const result: string[] = [];
    const added = new Set<string>();
    for (const id of [...seenIds, ...newlySeenIds]) {
        if (!added.has(id)) {
            added.add(id);
            result.push(id);
        }
    }
    return result;
}

/**
 * True when every tip in the given group has been seen. A group with no tips is
 * considered complete (vacuously true).
 */
export function isGroupComplete(allTips: readonly TipLike[], seenIds: readonly string[], group: string): boolean {
    const seen = new Set(seenIds);
    return allTips.filter((tip) => tip.group === group).every((tip) => seen.has(tip.id));
}

/** True when the user has seen every tip in the registry. */
export function areAllTipsSeen(allTips: readonly TipLike[], seenIds: readonly string[]): boolean {
    const seen = new Set(seenIds);
    return allTips.every((tip) => seen.has(tip.id));
}

/**
 * Decides whether the *automatic* Quick Start tour should fire, based purely on
 * the authored tip-set version.
 *
 * Returns true when:
 *  - there is no recorded `storedVersion` (fresh install / first run), or
 *  - the `currentVersion` differs from `storedVersion` in either direction.
 *
 * A change in either direction re-shows the whole tour: the tip version is the
 * deliberate switch the authors flip when they want everyone to see the tour
 * again, so a downgrade/rollback re-triggers it too. The caller is expected to
 * reset the "seen" state and record `currentVersion` once it returns true, so
 * the next open with an unchanged version is a no-op.
 */
export function tipsVersionChanged(currentVersion: number, storedVersion: number | undefined): boolean {
    return storedVersion === undefined || currentVersion !== storedVersion;
}
