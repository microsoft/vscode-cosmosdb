/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { type SerializedQueryResult } from '../../../../cosmosdb/types/queryResult';
import { CopyToClipboardButton } from './CopyToClipboardButton';
import { ExportButton } from './ExportButton';

const { state, dispatcher, hotkeys } = vi.hoisted(() => ({
    state: {
        selectedRows: [] as number[],
        isConnected: true,
        dbName: 'database',
        containerName: 'container',
        partitionKey: undefined,
        currentQueryResult: {
            documents: [{ id: 'first' }, { id: 'second' }, { id: 'third' }],
            iteration: 1,
            metadata: {},
            indexMetrics: '',
            requestCharge: 0,
            roundTrips: 1,
            hasMoreResults: false,
            query: 'SELECT * FROM c',
        } satisfies SerializedQueryResult,
    },
    dispatcher: {
        copyCSVToClipboard: vi.fn(),
        copyToClipboard: vi.fn(),
        saveCSV: vi.fn(),
        saveToFile: vi.fn(),
    },
    hotkeys: new Map<string, () => Promise<unknown>>(),
}));

vi.mock('../state/QueryEditorContext', () => ({
    useQueryEditorState: () => state,
    useQueryEditorDispatcher: () => dispatcher,
}));

vi.mock('../../../common/hotkeys', () => ({
    getShortcutDisplay: () => undefined,
    useCommandHotkey: (_scope: string, command: string, callback: () => Promise<unknown>) => {
        hotkeys.set(command, callback);
    },
}));

const selections = [
    { label: 'no selection', rows: [], expected: ['first', 'second', 'third'] },
    { label: 'one selected row', rows: [1], expected: ['second'] },
    { label: 'multiple selected rows', rows: [0, 2], expected: ['first', 'third'] },
];

const actions = [
    {
        label: 'copy',
        Component: CopyToClipboardButton,
        allResultsAccessibleName: 'Copy all results from the current page to clipboard',
        selectedItemsAccessibleName: 'Copy selected items to clipboard',
        metricsAccessibleName: 'Copy query metrics to clipboard',
        csvSink: dispatcher.copyCSVToClipboard,
        csvPrefix: [],
        jsonSink: dispatcher.copyToClipboard,
        jsonSuffix: [],
        hotkey: 'CopyToClipboard',
    },
    {
        label: 'export',
        Component: ExportButton,
        allResultsAccessibleName: 'Export all results from the current page',
        selectedItemsAccessibleName: 'Export selected items',
        metricsAccessibleName: 'Export query metrics',
        csvSink: dispatcher.saveCSV,
        csvPrefix: ['database_container_query_result'],
        jsonSink: dispatcher.saveToFile,
        jsonSuffix: ['database_container_query_result', 'json'],
        hotkey: 'SaveToDisk',
    },
];

for (const {
    label: action,
    Component,
    allResultsAccessibleName,
    selectedItemsAccessibleName,
    metricsAccessibleName,
    csvSink,
    csvPrefix,
    jsonSink,
    jsonSuffix,
    hotkey,
} of actions) {
    describe(`${action} query results`, () => {
        beforeEach(() => {
            vi.clearAllMocks();
            hotkeys.clear();
        });

        const renderAction = () =>
            render(
                <FluentProvider theme={webLightTheme}>
                    <Component type="button" selectedTab="result__tab" />
                </FluentProvider>,
            );

        for (const { label, rows, expected } of selections) {
            it(`CSV respects ${label}`, async () => {
                state.selectedRows = rows;
                renderAction();
                const button = screen.getByRole('button');
                expect(button).toHaveAccessibleName(
                    rows.length ? selectedItemsAccessibleName : allResultsAccessibleName,
                );
                fireEvent.click(button);
                fireEvent.click(await screen.findByRole('menuitem', { name: 'CSV' }));
                await waitFor(() =>
                    expect(csvSink).toHaveBeenCalledWith(
                        ...csvPrefix,
                        state.currentQueryResult,
                        state.partitionKey,
                        rows.length ? rows : undefined,
                    ),
                );
            });

            it(`JSON respects ${label}`, async () => {
                state.selectedRows = rows;
                renderAction();
                fireEvent.click(screen.getByRole('button'));
                fireEvent.click(await screen.findByRole('menuitem', { name: 'JSON' }));
                await waitFor(() => expect(jsonSink).toHaveBeenCalledOnce());
                expect(JSON.parse(jsonSink.mock.calls[0][0] as string)).toEqual(expected.map((id) => ({ id })));
                expect(jsonSink.mock.calls[0].slice(1)).toEqual(jsonSuffix);
            });

            it(`JSON hotkey respects ${label}`, async () => {
                state.selectedRows = rows;
                renderAction();
                const callback = hotkeys.get(hotkey);
                expect(callback).toBeDefined();
                await act(async () => {
                    await callback?.();
                });
                expect(jsonSink).toHaveBeenCalledOnce();
                expect(JSON.parse(jsonSink.mock.calls[0][0] as string)).toEqual(expected.map((id) => ({ id })));
                expect(jsonSink.mock.calls[0].slice(1)).toEqual(jsonSuffix);
            });
        }

        it('describes query metrics on the Stats tab', () => {
            state.selectedRows = [0, 1];
            render(
                <FluentProvider theme={webLightTheme}>
                    <Component type="button" selectedTab="stats__tab" />
                </FluentProvider>,
            );

            expect(screen.getByRole('button')).toHaveAccessibleName(metricsAccessibleName);
        });
    });
}
