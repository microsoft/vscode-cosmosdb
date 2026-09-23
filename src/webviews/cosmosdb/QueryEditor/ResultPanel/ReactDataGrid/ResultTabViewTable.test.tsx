/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { ResultTabViewTable } from './ResultTabViewTable';

const { dispatcher } = vi.hoisted(() => ({
    dispatcher: {
        setSelectedRows: vi.fn(),
    },
}));

vi.mock('../../state/QueryEditorContext', () => ({
    useQueryEditorState: () => ({ isEditMode: false }),
    useQueryEditorDispatcher: () => dispatcher,
}));

const renderTable = () => {
    render(
        <FluentProvider theme={webLightTheme}>
            <ResultTabViewTable
                headers={['id']}
                dataset={[
                    { __id: '1', id: 'first' },
                    { __id: '2', id: 'second' },
                    { __id: '3', id: 'third' },
                ]}
            />
        </FluentProvider>,
    );

    // jsdom lacks the grid's CSS nesting selector syntax and scrollIntoView.
    const grid = screen.getByRole('grid', { name: 'Query results table' });
    const querySelector = grid.querySelector.bind(grid);
    vi.spyOn(grid, 'querySelector').mockImplementation((selector) => querySelector(selector.replace(/^&/, ':scope')));
    for (const cell of [...screen.getAllByRole('gridcell'), ...screen.getAllByRole('columnheader')]) {
        cell.scrollIntoView = vi.fn();
    }
};

describe('ResultTabViewTable keyboard selection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('toggles the active row with Space', () => {
        renderTable();
        const cell = screen.getByRole('gridcell', { name: 'first' });
        fireEvent.mouseDown(cell);
        fireEvent.click(cell);
        expect(dispatcher.setSelectedRows).toHaveBeenLastCalledWith([0]);

        fireEvent.keyDown(cell, { key: ' ' });
        expect(dispatcher.setSelectedRows).toHaveBeenLastCalledWith([]);

        fireEvent.keyDown(cell, { key: ' ' });
        expect(dispatcher.setSelectedRows).toHaveBeenLastCalledWith([0]);
    });

    it('extends and shrinks the selection with Shift+Arrow', () => {
        renderTable();
        const firstCell = screen.getByRole('gridcell', { name: 'first' });
        fireEvent.mouseDown(firstCell);
        fireEvent.click(firstCell);

        fireEvent.keyDown(firstCell, { key: 'ArrowDown', shiftKey: true });
        expect(dispatcher.setSelectedRows).toHaveBeenLastCalledWith([0, 1]);

        const secondCell = screen.getByRole('gridcell', { name: 'second' });
        expect(secondCell).toHaveFocus();
        fireEvent.keyDown(secondCell, { key: 'ArrowUp', shiftKey: true });
        expect(dispatcher.setSelectedRows).toHaveBeenLastCalledWith([0]);
        expect(firstCell).toHaveFocus();
    });

    it('selects a range from the anchor with Shift+Space', () => {
        renderTable();
        const firstCell = screen.getByRole('gridcell', { name: 'first' });
        fireEvent.mouseDown(firstCell);
        fireEvent.click(firstCell);

        fireEvent.keyDown(firstCell, { key: 'ArrowDown' });
        const secondCell = screen.getByRole('gridcell', { name: 'second' });
        expect(secondCell).toHaveFocus();
        fireEvent.keyDown(secondCell, { key: ' ', shiftKey: true });
        expect(dispatcher.setSelectedRows).toHaveBeenLastCalledWith([0, 1]);
    });

    it('ignores header keyboard events without a data row', () => {
        renderTable();
        const cell = screen.getByRole('gridcell', { name: 'first' });
        fireEvent.mouseDown(cell);
        fireEvent.click(cell);
        fireEvent.keyDown(cell, { key: 'ArrowUp' });
        dispatcher.setSelectedRows.mockClear();

        const header = screen.getByRole('columnheader');
        expect(header).toHaveFocus();
        fireEvent.keyDown(header, { key: ' ' });
        expect(dispatcher.setSelectedRows).not.toHaveBeenCalled();
    });
});
