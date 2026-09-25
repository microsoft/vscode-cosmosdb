/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type attachTrpc as attachTrpcHost } from '@microsoft/vscode-ext-webview/host';
import { vi } from 'vitest';
import * as vscode from 'vscode';
import { type NoSqlQueryConnection } from '../cosmosdb/NoSqlQueryConnection';
import { QueryEditorTab } from './QueryEditorTab';
import { type QueryEditorRouterContext } from './trpc/appRouter';
import { commitQueryConnection } from './trpc/queryEditorConnectionState';

const mocks = vi.hoisted(() => ({
    context: undefined as QueryEditorRouterContext | undefined,
    readSchema: vi.fn(),
}));

vi.mock('../constants', () => ({ getThemedIconPath: () => ({ light: 'icon.svg', dark: 'icon.svg' }) }));
vi.mock('../cosmosdb/CosmosDBCredential', () => ({ getCosmosDBKeyCredential: () => undefined }));
vi.mock('../services/SchemaFileStorage', () => ({
    SchemaFileStorage: {
        getInstance: () => ({ readSchema: mocks.readSchema }),
        getSchemaIdForConnection: (connection: NoSqlQueryConnection) => connection.containerId,
    },
}));
vi.mock('../services/SchemaService', () => ({
    SchemaService: { getInstance: () => ({ onSchemaChanged: () => ({ dispose: vi.fn() }) }) },
}));
vi.mock('../utils/survey', () => ({}));
vi.mock('./trpc/appRouter', () => ({ queryEditorAppRouter: {}, queryEditorCallerFactory: {} }));
vi.mock('@microsoft/vscode-ext-webview/host', async (importOriginal) => {
    const actual = await importOriginal<{ attachTrpc: typeof attachTrpcHost }>();
    const attachTrpc = (_panel: unknown, context: QueryEditorRouterContext) => {
        mocks.context = context;
        return { disposable: { dispose: vi.fn() } };
    };
    return { ...actual, attachTrpc, default: { ...actual, attachTrpc } };
});
vi.mock('./BaseTab', () => ({
    BaseTab: class {
        protected disposables: vscode.Disposable[] = [];
        protected telemetryContext = { addMaskedValue: vi.fn() };
        constructor(protected panel: vscode.WebviewPanel) {}
        dispose() {
            this.disposables.forEach((disposable) => disposable.dispose());
        }
    },
}));

class TestQueryEditorTab extends QueryEditorTab {
    constructor() {
        super({ iconPath: undefined } as vscode.WebviewPanel);
    }
}

const connectionA: NoSqlQueryConnection = {
    endpoint: 'https://account.documents.azure.com',
    databaseId: 'db',
    containerId: 'A',
    credentials: [],
    isEmulator: false,
};

function setup() {
    const tab = new TestQueryEditorTab();
    const context = mocks.context!;
    context.state.connection = connectionA;
    return { tab, context, emit: vi.spyOn(tab.eventSink, 'emit') };
}

describe('query editor schema event ownership', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.readSchema.mockResolvedValue(null);
        vi.mocked(vscode.workspace.onDidChangeConfiguration).mockReturnValue({ dispose: vi.fn() });
    });

    afterEach(() => {
        for (const tab of QueryEditorTab.openTabs) tab.dispose();
    });

    for (const target of ['B', 'A', 'disconnected']) {
        it(`drops an in-flight schema read after switching to ${target}`, async () => {
            const { tab, context, emit } = setup();
            let finishRead!: (schema: string) => void;
            mocks.readSchema.mockReturnValueOnce(new Promise<string>((resolve) => (finishRead = resolve)));
            const sending = tab.sendSchemaToWebview();
            expect(mocks.readSchema).toHaveBeenCalledWith('A');

            commitQueryConnection(context, { ...connectionA, containerId: 'B' });
            if (target === 'A') commitQueryConnection(context, connectionA);
            else if (target === 'disconnected') commitQueryConnection(context);
            finishRead('{"type":"object","properties":{"old":{"type":"string"}}}');
            await sending;

            expect(emit).not.toHaveBeenCalled();
        });
    }

    it('tags current schema events with their connection generation', async () => {
        const { tab, context, emit } = setup();
        commitQueryConnection(context, { ...connectionA, containerId: 'B' });
        mocks.readSchema.mockResolvedValueOnce('{"type":"object"}');
        await tab.sendSchemaToWebview();
        expect(emit).toHaveBeenLastCalledWith({
            type: 'schemaUpdated',
            connectionVersion: 1,
            containerSchema: { type: 'object' },
        });

        commitQueryConnection(context);
        await tab.sendSchemaToWebview();
        expect(emit).toHaveBeenLastCalledWith({
            type: 'schemaUpdated',
            connectionVersion: 2,
            containerSchema: null,
        });
    });
});
