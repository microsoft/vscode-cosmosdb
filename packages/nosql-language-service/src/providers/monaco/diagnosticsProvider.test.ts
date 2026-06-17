/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SqlLanguageService } from '../../services/SqlLanguageService.js';
import { MonacoDiagnosticsProvider } from './diagnosticsProvider.js';
import { type MonacoNamespace } from './types.js';

function makeModel(text: string, languageId = 'cosmosdb-sql') {
    const contentListeners: (() => void)[] = [];
    const disposeListeners: (() => void)[] = [];
    return {
        getValue: () => text,
        getLanguageId: () => languageId,
        onDidChangeContent: vi.fn((cb: () => void) => {
            contentListeners.push(cb);
            return { dispose: vi.fn() };
        }),
        onWillDispose: vi.fn((cb: () => void) => {
            disposeListeners.push(cb);
            return { dispose: vi.fn() };
        }),
        fireChange: () => contentListeners.forEach((c) => c()),
        fireDispose: () => disposeListeners.forEach((c) => c()),
    };
}

function createMonacoMock(models: ReturnType<typeof makeModel>[]) {
    const listeners: {
        createModel?: (m: unknown) => void;
        changeLang?: (e: unknown) => void;
    } = {};
    const monaco = {
        listeners,
        editor: {
            getModels: () => models,
            setModelMarkers: vi.fn(),
            onDidCreateModel: vi.fn((cb: (m: unknown) => void) => {
                listeners.createModel = cb;
                return { dispose: vi.fn() };
            }),
            onDidChangeModelLanguage: vi.fn((cb: (e: unknown) => void) => {
                listeners.changeLang = cb;
                return { dispose: vi.fn() };
            }),
        },
        MarkerSeverity: { Error: 8, Warning: 4, Info: 2, Hint: 1 },
    };
    return monaco as unknown as MonacoNamespace & typeof monaco;
}

const INVALID_QUERY = 'SELECT * FORM c';
const VALID_QUERY = 'SELECT * FROM c';

describe('MonacoDiagnosticsProvider', () => {
    let service: SqlLanguageService;

    beforeEach(() => {
        service = new SqlLanguageService();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('registers model lifecycle listeners', () => {
        const monaco = createMonacoMock([]);
        new MonacoDiagnosticsProvider(monaco, service);
        expect(monaco.editor.onDidCreateModel).toHaveBeenCalled();
        expect(monaco.editor.onDidChangeModelLanguage).toHaveBeenCalled();
    });

    it('publishes markers for existing matching models on construction', () => {
        const model = makeModel(INVALID_QUERY);
        const monaco = createMonacoMock([model as unknown as ReturnType<typeof makeModel>]);
        new MonacoDiagnosticsProvider(monaco, service);
        expect(monaco.editor.setModelMarkers).toHaveBeenCalledTimes(1);
        const [, owner, markers] = monaco.editor.setModelMarkers.mock.calls[0];
        expect(owner).toBe('cosmosdb-sql');
        expect((markers as unknown[]).length).toBeGreaterThan(0);
        // severity is mapped to a Monaco MarkerSeverity value
        expect((markers as { severity: number }[])[0].severity).toBe(monaco.MarkerSeverity.Error);
    });

    it('ignores models with a non-matching language', () => {
        const model = makeModel(INVALID_QUERY, 'plaintext');
        const monaco = createMonacoMock([model]);
        new MonacoDiagnosticsProvider(monaco, service);
        expect(monaco.editor.setModelMarkers).not.toHaveBeenCalled();
    });

    it('observes models created after construction', () => {
        const monaco = createMonacoMock([]);
        new MonacoDiagnosticsProvider(monaco, service);
        const model = makeModel(VALID_QUERY);
        monaco.listeners.createModel?.(model);
        expect(model.onDidChangeContent).toHaveBeenCalled();
        expect(monaco.editor.setModelMarkers).toHaveBeenCalled();
    });

    it('debounces marker updates on content change', () => {
        vi.useFakeTimers();
        const model = makeModel(VALID_QUERY);
        const monaco = createMonacoMock([model]);
        new MonacoDiagnosticsProvider(monaco, service, { diagnosticDelay: 100 });
        monaco.editor.setModelMarkers.mockClear();

        model.fireChange();
        expect(monaco.editor.setModelMarkers).not.toHaveBeenCalled();
        vi.advanceTimersByTime(100);
        expect(monaco.editor.setModelMarkers).toHaveBeenCalled();
    });

    it('clears markers when a model is disposed', () => {
        const model = makeModel(VALID_QUERY);
        const monaco = createMonacoMock([model]);
        new MonacoDiagnosticsProvider(monaco, service);
        monaco.editor.setModelMarkers.mockClear();

        model.fireDispose();
        const lastCall = monaco.editor.setModelMarkers.mock.calls.at(-1);
        expect(lastCall?.[2]).toHaveLength(0);
    });

    it('dispose unobserves all models', () => {
        const model = makeModel(VALID_QUERY);
        const monaco = createMonacoMock([model]);
        const provider = new MonacoDiagnosticsProvider(monaco, service);
        expect(() => provider.dispose()).not.toThrow();
    });
});
