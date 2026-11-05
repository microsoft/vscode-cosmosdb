/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';
import { type TreeElement } from '../TreeElement';
import { makeFilterable } from './Filterable';
import { makeSortable } from './Sortable';

describe.each([
    ['filterable', makeFilterable],
    ['sortable', makeSortable],
    ['filterable and sortable', (item: TreeElement) => makeFilterable(makeSortable(item))],
] as const)('%s child loading', (_name, decorate) => {
    it('forwards the original operation context to the child loader', async () => {
        const getChildren = vi.fn<NonNullable<TreeElement['getChildren']>>().mockResolvedValue([]);
        const item = decorate({ id: 'account', getTreeItem: () => ({}), getChildren });
        const context = { propagateErrors: true };

        await expect(item.getChildren?.(context)).resolves.toEqual([]);
        expect(getChildren).toHaveBeenCalledExactlyOnceWith(context);
    });

    it.each([undefined, null])('preserves the valid empty ProviderResult %s', async (result) => {
        const getChildren = vi.fn<NonNullable<TreeElement['getChildren']>>().mockResolvedValue(result);
        const item = decorate({ id: 'account', getTreeItem: () => ({}), getChildren });

        await expect(item.getChildren?.({ propagateErrors: true })).resolves.toBe(result);
    });
});
