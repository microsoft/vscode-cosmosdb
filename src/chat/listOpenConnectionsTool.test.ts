/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { type NoSqlQueryConnection } from '../cosmosdb/NoSqlQueryConnection';
import { type QueryEditorTab } from '../panels/QueryEditorTab';
import { toConnectionInfo } from './listOpenConnectionsTool';

// `toConnectionInfo` is a pure mapper. Mock the heavy sibling modules the tool file imports (but that
// this function never touches) so the unit under test loads without the panel / tree / vscode graph.
vi.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: vi.fn(),
    parseError: (error: unknown) => ({ message: error instanceof Error ? error.message : String(error) }),
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
    getActiveQueryEditor: vi.fn(),
    getConnectionFromQueryTab: vi.fn(),
}));

vi.mock('./revealConnection', () => ({
    revealConnectionInTree: vi.fn(),
}));

function mockTab(isActive: boolean, isVisible: boolean): QueryEditorTab {
    return { isActive: () => isActive, isVisible: () => isVisible } as unknown as QueryEditorTab;
}

describe('toConnectionInfo', () => {
    it('maps an Azure-signed-in connection with its Azure coordinates and marks it revealable', () => {
        const connection = {
            databaseId: 'db',
            containerId: 'c',
            isEmulator: false,
            azureMetadata: {
                accountName: 'my-account',
                resourceGroup: 'my-rg',
                subscription: { subscriptionId: 'sub-123', name: 'My Sub' },
            },
        } as unknown as NoSqlQueryConnection;

        const info = toConnectionInfo(mockTab(true, true), connection);

        expect(info).toEqual({
            databaseId: 'db',
            containerId: 'c',
            isEmulator: false,
            isActive: true,
            isVisible: true,
            canRevealInTree: true,
            azure: {
                accountName: 'my-account',
                subscriptionId: 'sub-123',
                subscriptionName: 'My Sub',
                resourceGroup: 'my-rg',
            },
        });
    });

    it('omits Azure coordinates and is not revealable for workspace-attached / emulator connections', () => {
        const connection = {
            databaseId: 'localdb',
            containerId: 'localc',
            isEmulator: true,
            azureMetadata: undefined,
        } as unknown as NoSqlQueryConnection;

        const info = toConnectionInfo(mockTab(false, false), connection);

        expect(info.azure).toBeUndefined();
        expect(info.canRevealInTree).toBe(false);
        expect(info.isEmulator).toBe(true);
        expect(info.isActive).toBe(false);
        expect(info.isVisible).toBe(false);
    });

    it('reflects the tab active/visible state', () => {
        const connection = {
            databaseId: 'db',
            containerId: 'c',
            isEmulator: false,
            azureMetadata: undefined,
        } as unknown as NoSqlQueryConnection;

        expect(toConnectionInfo(mockTab(true, false), connection).isActive).toBe(true);
        expect(toConnectionInfo(mockTab(false, true), connection).isVisible).toBe(true);
    });

    it('never exposes the connection endpoint (account host) to the model', () => {
        const connection = {
            databaseId: 'db',
            containerId: 'c',
            isEmulator: false,
            endpoint: 'https://secret-account.documents.azure.com/',
            azureMetadata: undefined,
        } as unknown as NoSqlQueryConnection;

        const info = toConnectionInfo(mockTab(false, true), connection);

        expect(info).not.toHaveProperty('endpoint');
    });
});
