/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { selectConnectionToFocus } from './focusQueryEditorTool';

// `selectConnectionToFocus` is pure. Mock the heavy sibling modules the tool file imports (but that
// this function never touches) so the unit under test loads without the panel / tRPC / vscode graph.
vi.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: vi.fn(),
}));

vi.mock('../extensionVariables', () => ({
    ext: { outputChannel: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
}));

vi.mock('../panels/QueryEditorTab', () => ({
    QueryEditorTab: class {
        static openTabs = new Set();
    },
}));

vi.mock('./chatUtils', () => ({
    getConnectionFromQueryTab: vi.fn(),
}));

type Entry = { tab: { isActive: () => boolean }; connection: { databaseId: string; containerId: string } };

function entry(databaseId: string, containerId: string, isActive: boolean): Entry {
    return { tab: { isActive: () => isActive }, connection: { databaseId, containerId } };
}

describe('selectConnectionToFocus', () => {
    it('returns no target when there are no open connections', () => {
        const { matches, target } = selectConnectionToFocus([], 'db', 'c');

        expect(matches).toHaveLength(0);
        expect(target).toBeUndefined();
    });

    it('returns no target when nothing matches the database/container', () => {
        const entries = [entry('db', 'other', false), entry('otherDb', 'c', false)];

        const { matches, target } = selectConnectionToFocus(entries, 'db', 'c');

        expect(matches).toHaveLength(0);
        expect(target).toBeUndefined();
    });

    it('requires BOTH databaseId and containerId to match', () => {
        const entries = [entry('db', 'c1', false), entry('db2', 'c', false)];

        const { target } = selectConnectionToFocus(entries, 'db', 'c');

        expect(target).toBeUndefined();
    });

    it('returns the single matching entry', () => {
        const match = entry('db', 'c', false);
        const entries = [entry('db', 'other', false), match];

        const { matches, target } = selectConnectionToFocus(entries, 'db', 'c');

        expect(matches).toEqual([match]);
        expect(target).toBe(match);
    });

    it('prefers a non-active match so focus makes a visible change', () => {
        const active = entry('db', 'c', true);
        const inactive = entry('db', 'c', false);

        const { matches, target } = selectConnectionToFocus([active, inactive], 'db', 'c');

        expect(matches).toEqual([active, inactive]);
        expect(target).toBe(inactive);
    });

    it('falls back to the first match when every match is already active', () => {
        const first = entry('db', 'c', true);
        const second = entry('db', 'c', true);

        const { target } = selectConnectionToFocus([first, second], 'db', 'c');

        expect(target).toBe(first);
    });

    it('returns the first match when none of the matches is active', () => {
        const first = entry('db', 'c', false);
        const second = entry('db', 'c', false);

        const { target } = selectConnectionToFocus([first, second], 'db', 'c');

        expect(target).toBe(first);
    });
});
