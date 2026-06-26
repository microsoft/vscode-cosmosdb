/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import {
    areAllTipsSeen,
    getPendingTips,
    getTipsInSegment,
    isGroupComplete,
    isMajorOrMinorUpgrade,
    markSeen,
    sortTips,
    type TipLike,
} from './quickStartState';

const tips: TipLike[] = [
    { id: 'run-query', group: 'editing' },
    { id: 'ai-assist', group: 'editing' },
    { id: 'view-schema', group: 'results' },
    { id: 'export-results', group: 'results' },
];

describe('getPendingTips', () => {
    it('returns all tips for a brand new user (no seen ids)', () => {
        expect(getPendingTips(tips, []).map((t) => t.id)).toEqual([
            'run-query',
            'ai-assist',
            'view-schema',
            'export-results',
        ]);
    });

    it('returns nothing when every tip has been seen', () => {
        const seen = tips.map((t) => t.id);
        expect(getPendingTips(tips, seen)).toEqual([]);
    });

    it('returns only the unseen tips for a partially-onboarded user', () => {
        const seen = ['run-query', 'ai-assist'];
        expect(getPendingTips(tips, seen).map((t) => t.id)).toEqual(['view-schema', 'export-results']);
    });

    it('surfaces only the new tip after an extension update adds a new id', () => {
        // User has seen the entire previous registry...
        const seen = tips.map((t) => t.id);
        // ...then an update introduces a brand new tip.
        const updatedRegistry: TipLike[] = [...tips, { id: 'partition-key', group: 'editing' }];
        expect(getPendingTips(updatedRegistry, seen).map((t) => t.id)).toEqual(['partition-key']);
    });

    it('ignores stale seen ids no longer present in the registry', () => {
        const seen = ['run-query', 'removed-old-tip'];
        expect(getPendingTips(tips, seen).map((t) => t.id)).toEqual(['ai-assist', 'view-schema', 'export-results']);
    });

    it('tolerates duplicate seen ids', () => {
        const seen = ['run-query', 'run-query', 'ai-assist'];
        expect(getPendingTips(tips, seen).map((t) => t.id)).toEqual(['view-schema', 'export-results']);
    });

    it('does not mutate its inputs', () => {
        const allTips = [...tips];
        const seen = ['run-query'];
        getPendingTips(allTips, seen);
        expect(allTips).toEqual(tips);
        expect(seen).toEqual(['run-query']);
    });
});

describe('getTipsInSegment', () => {
    const mixed: TipLike[] = [
        { id: 'intro' },
        { id: 'run-query', group: 'editor' },
        { id: 'connection', group: 'editor' },
        { id: 'export', group: 'result' },
    ];

    it('returns the tips of a given group in order', () => {
        expect(getTipsInSegment(mixed, 'editor').map((t) => t.id)).toEqual(['run-query', 'connection']);
    });

    it('returns ungrouped tips when group is null', () => {
        expect(getTipsInSegment(mixed, null).map((t) => t.id)).toEqual(['intro']);
    });

    it('returns an empty array for an unknown group', () => {
        expect(getTipsInSegment(mixed, 'nope')).toEqual([]);
    });

    it('does not mutate its input', () => {
        const copy = [...mixed];
        getTipsInSegment(mixed, 'editor');
        expect(mixed).toEqual(copy);
    });
});

describe('sortTips', () => {
    it('preserves array order when no explicit order is set', () => {
        expect(sortTips(tips).map((t) => t.id)).toEqual(['run-query', 'ai-assist', 'view-schema', 'export-results']);
    });

    it('places explicitly-ordered tips first, ascending, then unordered in input order', () => {
        const mixed: TipLike[] = [
            { id: 'a', group: 'g' },
            { id: 'b', group: 'g', order: 2 },
            { id: 'c', group: 'g' },
            { id: 'd', group: 'g', order: 1 },
        ];
        expect(sortTips(mixed).map((t) => t.id)).toEqual(['d', 'b', 'a', 'c']);
    });
});

describe('markSeen', () => {
    it('adds new ids to an empty set', () => {
        expect(markSeen([], ['run-query', 'ai-assist'])).toEqual(['run-query', 'ai-assist']);
    });

    it('is idempotent — re-marking an already-seen id is a no-op', () => {
        const seen = ['run-query', 'ai-assist'];
        expect(markSeen(seen, ['run-query'])).toEqual(['run-query', 'ai-assist']);
    });

    it('merges and de-duplicates while preserving first-appearance order', () => {
        expect(markSeen(['run-query'], ['ai-assist', 'run-query', 'view-schema'])).toEqual([
            'run-query',
            'ai-assist',
            'view-schema',
        ]);
    });

    it('does not mutate its inputs', () => {
        const seen = ['run-query'];
        const added = ['ai-assist'];
        markSeen(seen, added);
        expect(seen).toEqual(['run-query']);
        expect(added).toEqual(['ai-assist']);
    });
});

describe('isGroupComplete', () => {
    it('is false while any tip in the group is unseen', () => {
        expect(isGroupComplete(tips, ['run-query'], 'editing')).toBe(false);
    });

    it('is true once every tip in the group is seen', () => {
        expect(isGroupComplete(tips, ['run-query', 'ai-assist'], 'editing')).toBe(true);
    });

    it('is vacuously true for a group with no tips', () => {
        expect(isGroupComplete(tips, [], 'nonexistent')).toBe(true);
    });
});

describe('areAllTipsSeen', () => {
    it('is false for a new user', () => {
        expect(areAllTipsSeen(tips, [])).toBe(false);
    });

    it('is true once all tips are seen', () => {
        expect(
            areAllTipsSeen(
                tips,
                tips.map((t) => t.id),
            ),
        ).toBe(true);
    });
});

describe('isMajorOrMinorUpgrade', () => {
    it('allows the tour on a fresh install (no last version)', () => {
        expect(isMajorOrMinorUpgrade('1.2.3', undefined)).toBe(true);
    });

    it('does not auto-show for the same version', () => {
        expect(isMajorOrMinorUpgrade('1.2.3', '1.2.3')).toBe(false);
    });

    it('does not auto-show for a patch bump', () => {
        expect(isMajorOrMinorUpgrade('1.2.4', '1.2.3')).toBe(false);
    });

    it('auto-shows for a minor bump', () => {
        expect(isMajorOrMinorUpgrade('1.3.0', '1.2.9')).toBe(true);
    });

    it('auto-shows for a major bump', () => {
        expect(isMajorOrMinorUpgrade('2.0.0', '1.9.9')).toBe(true);
    });

    it('does not auto-show on a downgrade', () => {
        expect(isMajorOrMinorUpgrade('1.2.0', '1.3.0')).toBe(false);
        expect(isMajorOrMinorUpgrade('1.9.9', '2.0.0')).toBe(false);
    });

    it('treats an unparseable last version like a fresh install', () => {
        expect(isMajorOrMinorUpgrade('1.2.3', 'not-a-version')).toBe(true);
    });

    it('fails closed when the current version is unparseable', () => {
        expect(isMajorOrMinorUpgrade('not-a-version', '1.2.3')).toBe(false);
    });
});
