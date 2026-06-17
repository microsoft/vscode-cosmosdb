/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SqlLanguageService } from '../../services/SqlLanguageService.js';
import { MonacoMultiQueryDecorator } from './multiQueryDecorator.js';
import { type MonacoNamespace } from './types.js';

function makeModel(text: string, languageId = 'cosmosdb-sql') {
    const lines = text.split('\n');
    return {
        getValue: () => text,
        getLanguageId: () => languageId,
        getOffsetAt: (pos: { lineNumber: number; column: number }) => {
            let off = 0;
            for (let i = 0; i < pos.lineNumber - 1; i++) off += lines[i].length + 1;
            return off + pos.column - 1;
        },
        getPositionAt: (off: number) => {
            let rem = off;
            for (let i = 0; i < lines.length; i++) {
                if (rem <= lines[i].length) return { lineNumber: i + 1, column: rem + 1 };
                rem -= lines[i].length + 1;
            }
            return { lineNumber: lines.length, column: lines[lines.length - 1].length + 1 };
        },
        getLineMaxColumn: (lineNumber: number) => lines[lineNumber - 1].length + 1,
        onDidChangeContent: vi.fn(() => ({ dispose: vi.fn() })),
    };
}

function makeEditor(model: ReturnType<typeof makeModel> | null) {
    const decoCollections: { set: ReturnType<typeof vi.fn>; clear: ReturnType<typeof vi.fn> }[] = [];
    const addZone = vi.fn(() => `zone-${decoCollections.length}`);
    const removeZone = vi.fn();
    return {
        decoCollections,
        addZone,
        removeZone,
        getModel: () => model,
        createDecorationsCollection: vi.fn(() => {
            const c = { set: vi.fn(), clear: vi.fn() };
            decoCollections.push(c);
            return c;
        }),
        updateOptions: vi.fn(),
        getContainerDomNode: vi.fn(() => ({ style: { setProperty: vi.fn() } })),
        getLayoutInfo: vi.fn(() => ({ decorationsLeft: 10, decorationsWidth: 20 })),
        onDidLayoutChange: vi.fn(() => ({ dispose: vi.fn() })),
        onDidChangeCursorPosition: vi.fn(() => ({ dispose: vi.fn() })),
        getPosition: vi.fn(() => ({ lineNumber: 2, column: 1 })),
        changeViewZones: vi.fn((cb: (accessor: { addZone: typeof addZone; removeZone: typeof removeZone }) => void) =>
            cb({ addZone, removeZone }),
        ),
    };
}

function createMonacoMock(editors: ReturnType<typeof makeEditor>[]) {
    const monaco = {
        editor: {
            getEditors: () => editors,
            onDidCreateEditor: vi.fn(() => ({ dispose: vi.fn() })),
            onDidCreateModel: vi.fn(() => ({ dispose: vi.fn() })),
            onDidChangeModelLanguage: vi.fn(() => ({ dispose: vi.fn() })),
        },
    };
    return monaco as unknown as MonacoNamespace & typeof monaco;
}

const MULTI_QUERY = 'SELECT 1;\nSELECT 2;';
const SINGLE_QUERY = 'SELECT * FROM c';

describe('MonacoMultiQueryDecorator', () => {
    let service: SqlLanguageService;

    beforeEach(() => {
        service = new SqlLanguageService();
    });

    it('registers editor/model lifecycle listeners', () => {
        const monaco = createMonacoMock([]);
        new MonacoMultiQueryDecorator(monaco, service);
        expect(monaco.editor.onDidCreateEditor).toHaveBeenCalled();
        expect(monaco.editor.onDidCreateModel).toHaveBeenCalled();
        expect(monaco.editor.onDidChangeModelLanguage).toHaveBeenCalled();
    });

    it('attaches to an existing matching editor and reserves gutter width', () => {
        const editor = makeEditor(makeModel(MULTI_QUERY));
        const monaco = createMonacoMock([editor]);
        new MonacoMultiQueryDecorator(monaco, service);

        // Two decoration collections: separators + active block.
        expect(editor.createDecorationsCollection).toHaveBeenCalledTimes(2);
        expect(editor.updateOptions).toHaveBeenCalledWith(expect.objectContaining({ lineDecorationsWidth: 11 }));
    });

    it('sets separator decorations and view zones for a multi-query model', () => {
        const editor = makeEditor(makeModel(MULTI_QUERY));
        const monaco = createMonacoMock([editor]);
        new MonacoMultiQueryDecorator(monaco, service);

        // decoCollections[0] is the separator collection.
        expect(editor.decoCollections[0].set).toHaveBeenCalled();
        const decos = editor.decoCollections[0].set.mock.calls.at(-1)?.[0] as unknown[];
        expect(decos.length).toBeGreaterThan(0);
        // A view zone is added per separator line.
        expect(editor.changeViewZones).toHaveBeenCalled();
        expect(editor.addZone).toHaveBeenCalled();
    });

    it('highlights the active block when the cursor is inside a multi-query region', () => {
        const editor = makeEditor(makeModel(MULTI_QUERY));
        const monaco = createMonacoMock([editor]);
        new MonacoMultiQueryDecorator(monaco, service);

        // decoCollections[1] is the active-block collection.
        expect(editor.decoCollections[1].set).toHaveBeenCalled();
    });

    it('clears the active block for a single-query model', () => {
        const editor = makeEditor(makeModel(SINGLE_QUERY));
        const monaco = createMonacoMock([editor]);
        new MonacoMultiQueryDecorator(monaco, service);

        expect(editor.decoCollections[1].clear).toHaveBeenCalled();
        expect(editor.decoCollections[1].set).not.toHaveBeenCalled();
    });

    it('does not attach when the model language does not match', () => {
        const editor = makeEditor(makeModel(MULTI_QUERY, 'plaintext'));
        const monaco = createMonacoMock([editor]);
        new MonacoMultiQueryDecorator(monaco, service);
        expect(editor.createDecorationsCollection).not.toHaveBeenCalled();
    });

    it('does not highlight the active block when the option is disabled', () => {
        const editor = makeEditor(makeModel(MULTI_QUERY));
        const monaco = createMonacoMock([editor]);
        new MonacoMultiQueryDecorator(monaco, service, { highlightActiveBlock: false });
        expect(editor.onDidChangeCursorPosition).not.toHaveBeenCalled();
    });

    it('dispose clears decorations and removes view zones', () => {
        const editor = makeEditor(makeModel(MULTI_QUERY));
        const monaco = createMonacoMock([editor]);
        const decorator = new MonacoMultiQueryDecorator(monaco, service);
        editor.removeZone.mockClear();
        decorator.dispose();
        expect(editor.decoCollections[0].clear).toHaveBeenCalled();
        expect(editor.removeZone).toHaveBeenCalled();
    });
});
