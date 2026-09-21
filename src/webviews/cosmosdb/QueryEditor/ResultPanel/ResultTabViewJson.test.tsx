/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect, useRef, useState } from 'react';
import { vi } from 'vitest';
import { QUERY_RESULT_JSON_WARNING_BYTES } from '../../../../cosmosdb/queryResultJsonPolicy';
import { type SerializedQueryResult } from '../../../../cosmosdb/types/queryResult';
import { ResultTabViewJson } from './ResultTabViewJson';

const dispose = vi.fn();
const focus = vi.fn();
const keyDownDispose = vi.fn();
let keyDownHandler:
    | ((event: {
          altKey: boolean;
          ctrlKey: boolean;
          keyCode: number;
          metaKey: boolean;
          shiftKey: boolean;
          stopPropagation: () => void;
      }) => void)
    | undefined;
let hasTextSelection = false;

vi.mock('../../../MonacoEditor', () => ({
    MonacoEditor: ({
        defaultValue,
        options,
        onMount,
    }: {
        defaultValue: string;
        options: Record<string, unknown>;
        onMount?: (
            editor: {
                focus: () => void;
                getSelections: () => { isEmpty: () => boolean }[];
                getModel: () => {
                    applyEdits: (edits: { text: string }[]) => void;
                    dispose: () => void;
                    getPositionAt: () => { lineNumber: number; column: number };
                    getValueLength: () => number;
                    isDisposed: () => boolean;
                    setValue: (value: string) => void;
                };
                onKeyDown: (handler: NonNullable<typeof keyDownHandler>) => { dispose: () => void };
            },
            monaco: { KeyCode: { KeyC: number }; Range: new () => object },
        ) => void;
    }) => {
        const [value, setValue] = useState(defaultValue);
        const valueRef = useRef(defaultValue);

        useEffect(() => {
            const updateValue = (newValue: string) => {
                valueRef.current = newValue;
                setValue(newValue);
            };
            onMount?.(
                {
                    focus,
                    getSelections: () => [{ isEmpty: () => !hasTextSelection }],
                    getModel: () => ({
                        applyEdits: (edits) => updateValue(valueRef.current + edits.map((edit) => edit.text).join('')),
                        dispose,
                        getPositionAt: () => ({ lineNumber: 1, column: valueRef.current.length + 1 }),
                        getValueLength: () => valueRef.current.length,
                        isDisposed: () => false,
                        setValue: updateValue,
                    }),
                    onKeyDown: (handler) => {
                        keyDownHandler = handler;
                        return { dispose: keyDownDispose };
                    },
                },
                { KeyCode: { KeyC: 33 }, Range: class {} },
            );
        }, [onMount]);

        return <div data-testid="monaco" data-value={value} data-options={JSON.stringify(options)} />;
    },
}));

const makeResult = (text: string, iteration = 1): SerializedQueryResult => ({
    documents: [{ text }],
    iteration,
    metadata: {},
    indexMetrics: '',
    requestCharge: 0,
    roundTrips: 1,
    hasMoreResults: false,
    query: 'SELECT * FROM c',
});

const renderJsonView = (queryResult: SerializedQueryResult) =>
    render(
        <FluentProvider theme={webLightTheme}>
            <ResultTabViewJson queryResult={queryResult} />
        </FluentProvider>,
    );

describe('ResultTabViewJson', () => {
    beforeEach(() => {
        dispose.mockClear();
        focus.mockClear();
        keyDownDispose.mockClear();
        keyDownHandler = undefined;
        hasTextSelection = false;
    });

    it('opens a small result directly with the default editor options', async () => {
        renderJsonView(makeResult('small'));

        const editor = screen.getByTestId('monaco');
        expect(editor).toBeInTheDocument();
        await waitFor(() => expect(editor.dataset.value).toContain('small'));
        expect(JSON.parse(editor.dataset.options ?? '{}')).toEqual({
            ariaLabel: 'Query results JSON',
            domReadOnly: true,
            readOnly: true,
        });
    });

    it.each([
        { ctrlKey: true, metaKey: false },
        { ctrlKey: false, metaKey: true },
    ])('preserves native copy for a text selection with $ctrlKey/$metaKey', async ({ ctrlKey, metaKey }) => {
        hasTextSelection = true;
        renderJsonView(makeResult('selected text'));
        await waitFor(() => expect(keyDownHandler).toBeDefined());
        const stopPropagation = vi.fn();

        keyDownHandler?.({
            altKey: false,
            ctrlKey,
            keyCode: 33,
            metaKey,
            shiftKey: false,
            stopPropagation,
        });

        expect(stopPropagation).toHaveBeenCalledOnce();
    });

    it.each([
        { hasSelection: false, keyCode: 33, shiftKey: false },
        { hasSelection: true, keyCode: 34, shiftKey: false },
        { hasSelection: true, keyCode: 33, shiftKey: true },
    ])(
        'lets non-native-copy keydowns bubble with selection=$hasSelection, key=$keyCode, shift=$shiftKey',
        async ({ hasSelection, keyCode, shiftKey }) => {
            hasTextSelection = hasSelection;
            renderJsonView(makeResult('selected text'));
            await waitFor(() => expect(keyDownHandler).toBeDefined());
            const stopPropagation = vi.fn();

            keyDownHandler?.({
                altKey: false,
                ctrlKey: true,
                keyCode,
                metaKey: false,
                shiftKey,
                stopPropagation,
            });

            expect(stopPropagation).not.toHaveBeenCalled();
        },
    );

    it('shows an accessible warning without mounting Monaco for a large result', () => {
        renderJsonView(makeResult('x'.repeat(QUERY_RESULT_JSON_WARNING_BYTES)));

        expect(screen.getByText('Large JSON result')).toBeInTheDocument();
        const showPreviewButton = screen.getByRole('button', { name: 'Show preview' });
        expect(showPreviewButton).toBeInTheDocument();
        expect(showPreviewButton).toHaveAccessibleDescription('Open only the first 512 KiB of the JSON result.');
        expect(screen.getByRole('button', { name: 'Open all' })).toBeInTheDocument();
        expect(screen.queryByTestId('monaco')).not.toBeInTheDocument();
    });

    it('opens a bounded preview and then incrementally loads the complete result only after explicit actions', async () => {
        renderJsonView(makeResult('x'.repeat(QUERY_RESULT_JSON_WARNING_BYTES)));

        fireEvent.click(screen.getByRole('button', { name: 'Show preview' }));

        const previewEditor = screen.getByTestId('monaco');
        expect(screen.getByText('Preview only')).toBeInTheDocument();
        await waitFor(() => expect(previewEditor.dataset.value).toContain('x'.repeat(1024)));
        await waitFor(() =>
            expect(new TextEncoder().encode(previewEditor.dataset.value).byteLength).toBeLessThanOrEqual(512 * 1024),
        );
        expect(JSON.parse(previewEditor.dataset.options ?? '{}')).toMatchObject({
            largeFileOptimizations: true,
            folding: false,
            links: false,
            minimap: { enabled: false },
        });

        fireEvent.click(screen.getByRole('button', { name: 'Open all' }));

        expect(screen.queryByText('Preview only')).not.toBeInTheDocument();
        await waitFor(() => expect(screen.getByTestId('monaco').dataset.value).toContain('x'.repeat(1024)));
        expect(dispose).toHaveBeenCalled();
    });

    it('resets consent when the query result changes', () => {
        const firstResult = makeResult('x'.repeat(QUERY_RESULT_JSON_WARNING_BYTES), 1);
        const { rerender } = renderJsonView(firstResult);
        fireEvent.click(screen.getByRole('button', { name: 'Open all' }));
        expect(screen.getByTestId('monaco')).toBeInTheDocument();

        rerender(
            <FluentProvider theme={webLightTheme}>
                <ResultTabViewJson queryResult={makeResult('y'.repeat(QUERY_RESULT_JSON_WARNING_BYTES), 2)} />
            </FluentProvider>,
        );

        expect(screen.getByText('Large JSON result')).toBeInTheDocument();
        expect(screen.queryByTestId('monaco')).not.toBeInTheDocument();
    });
});
