/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectionButton } from './ConnectionButton';
import { DiagnoseConnectionButton } from './DiagnoseConnectionButton';

const { state, dispatcher } = vi.hoisted(() => ({
    state: {
        dbName: '',
        containerName: '',
        isConnected: false,
        isChangingConnection: false,
        connectionList: undefined,
    },
    dispatcher: { getConnections: vi.fn(), setConnection: vi.fn(), diagnoseConnection: vi.fn() },
}));

vi.mock('../state/QueryEditorContext', () => ({
    useQueryEditorState: () => state,
    useQueryEditorDispatcher: () => dispatcher,
}));

describe('connection picker accessible name', () => {
    beforeEach(() => {
        state.dbName = '';
        state.containerName = '';
        state.isConnected = false;
        state.isChangingConnection = false;
    });

    describe('diagnose the selected connection from Query Editor', () => {
        afterEach(cleanup);

        it.each([
            { type: 'button', connected: true, changing: false },
            { type: 'menuitem', connected: true, changing: false },
            { type: 'button', connected: false, changing: false },
            { type: 'menuitem', connected: true, changing: true },
        ] as const)(
            'handles $type with connected=$connected and changing=$changing',
            ({ type, connected, changing }) => {
                dispatcher.diagnoseConnection.mockClear();
                state.isConnected = connected;
                state.isChangingConnection = changing;
                render(
                    <FluentProvider theme={webLightTheme}>
                        <DiagnoseConnectionButton type={type} />
                    </FluentProvider>,
                );

                const action = screen.getByRole(type, { name: 'Diagnose Connection.' });
                fireEvent.click(action);
                expect(dispatcher.diagnoseConnection).toHaveBeenCalledTimes(connected && !changing ? 1 : 0);
            },
        );
    });

    afterEach(cleanup);

    it.each([
        { database: '', container: '', changing: false },
        { database: 'database', container: 'container', changing: false },
        { database: 'database', container: 'container', changing: true },
    ])(
        'includes the purpose and visible value for $database/$container (changing: $changing)',
        ({ database, container, changing }) => {
            state.dbName = database;
            state.containerName = container;
            state.isConnected = !!database && !!container;
            state.isChangingConnection = changing;
            render(
                <FluentProvider theme={webLightTheme}>
                    <ConnectionButton type="button" />
                </FluentProvider>,
            );

            const currentValue = database && container ? `${database}/${container}` : '';
            const picker = screen.getByRole('combobox', {
                name: currentValue ? `Connect to ${currentValue}` : 'Connect to…',
            });
            expect(picker.textContent).toBe(currentValue || 'Connect to…');
            expect(picker).toHaveProperty('disabled', changing);
        },
    );
});
