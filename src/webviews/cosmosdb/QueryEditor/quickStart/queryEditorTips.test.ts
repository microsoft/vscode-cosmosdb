/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import {
    getQueryEditorTips,
    QUERY_EDITOR_RESULTS_TIP_GROUP,
    QUERY_EDITOR_TIP_GROUP,
    QUERY_EDITOR_TIP_GROUPS,
} from './queryEditorTips';

describe('queryEditorTips registry', () => {
    const tips = getQueryEditorTips();

    it('has at least one tip', () => {
        expect(tips.length).toBeGreaterThan(0);
    });

    it('uses unique ids', () => {
        const ids = tips.map((t) => t.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('gives every tip a non-empty title and body', () => {
        for (const tip of tips) {
            expect(tip.title.trim().length).toBeGreaterThan(0);
            expect(tip.body.trim().length).toBeGreaterThan(0);
        }
    });

    it('targets a data-quickstart selector for every tip', () => {
        for (const tip of tips) {
            expect(tip.targetSelector).toMatch(/^\[data-quickstart="[^"]+"\]$/);
        }
    });

    it('places every tip in a known query editor group (or leaves it ungrouped)', () => {
        const unknownGroups = tips
            .map((tip) => tip.group)
            .filter((group): group is string => group !== undefined && !QUERY_EDITOR_TIP_GROUPS.includes(group));
        expect(unknownGroups).toEqual([]);
    });

    it('includes tips for the result panel', () => {
        const resultTips = tips.filter((t) => t.group === QUERY_EDITOR_RESULTS_TIP_GROUP);
        expect(resultTips.length).toBeGreaterThan(0);
    });

    it('orders the editor group as run, ai, schema, feedback, connection, page size', () => {
        const editorIds = tips.filter((t) => t.group === QUERY_EDITOR_TIP_GROUP).map((t) => t.id);
        expect(editorIds).toEqual([
            'run-query',
            'ai-assist',
            'view-schema',
            'provide-feedback',
            'connection',
            'page-size',
        ]);
    });

    it('orders the result group as tabs, add, view, edit, reload, pagination, export', () => {
        const resultIds = tips.filter((t) => t.group === QUERY_EDITOR_RESULTS_TIP_GROUP).map((t) => t.id);
        expect(resultIds).toEqual([
            'result-tabs',
            'new-item',
            'view-item',
            'edit-item',
            'reload-query',
            'pagination',
            'export-results',
        ]);
    });
});
