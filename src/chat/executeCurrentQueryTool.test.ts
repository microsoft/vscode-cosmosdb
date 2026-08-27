/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as vscode from 'vscode';
import { findConfidentialStatKeys } from '../services/schemaStatisticsTestUtils';
import { registerExecuteCurrentQueryTool } from './executeCurrentQueryTool';
import { captureRegisteredTool, invokeRegisteredTool, serializeToolResult } from './queryEditorToolTestUtils';
import { createQueryExecutionContext } from './queryExecutionContext';

// Drive the telemetry wrapper synchronously so the tool body runs end-to-end and we can inspect
// the LanguageModelToolResult it returns.
vi.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: vi.fn(async (_event: string, callback: (ctx: unknown) => unknown) => {
        const ctx = {
            telemetry: { properties: {} as Record<string, string>, measurements: {} as Record<string, number> },
            errorHandling: { suppressDisplay: false },
            valuesToMask: [] as string[],
        };
        return callback(ctx);
    }),
    parseError: (error: unknown) => ({ message: error instanceof Error ? error.message : String(error) }),
}));

vi.mock('../extensionVariables', () => ({
    ext: { outputChannel: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
}));

// `getActiveTab` requires a non-empty `openTabs`; the actual tab is resolved via
// `getActiveQueryEditor`, which we stub below.
vi.mock('../panels/QueryEditorTab', () => ({
    QueryEditorTab: { openTabs: new Set([{}]) },
}));

vi.mock('./chatUtils', () => ({
    getActiveQueryEditor: vi.fn(),
    getConnectionFromQueryTab: vi.fn(),
}));

describe('cosmosdb_executeCurrentQuery — confidentiality', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('never sends value-derived statistics or raw values to the model', async () => {
        const { getConnectionFromQueryTab } = await import('./chatUtils');
        const { QueryEditorTab } = await import('../panels/QueryEditorTab');

        const tab = {
            getId: vi.fn(() => 'tab-1'),
            getSelectedQuery: vi.fn(() => undefined),
            getCurrentQuery: vi.fn(() => 'SELECT * FROM c'),
            runActiveQueryInEditor: vi.fn(async () => 'exec-1'),
            getCurrentQueryResults: vi.fn(() => ({
                query: 'SELECT * FROM c',
                documents: [
                    { id: '1', salary: 987654, nationalId: 'AB-123456789', active: true },
                    { id: '2', salary: 42, nationalId: 'CD-9', active: false },
                ],
                requestCharge: 3.14,
                roundTrips: 1,
                hasMoreResults: false,
            })),
        };
        const connection = {
            endpoint: 'https://example.documents.azure.com/',
            databaseId: 'db1',
            containerId: 'c1',
        };
        setOpenTabs(QueryEditorTab as unknown as { openTabs: Set<unknown> }, [tab]);
        vi.mocked(getConnectionFromQueryTab).mockReturnValue(connection as never);
        const queryContextId = createQueryExecutionContext(tab as never, connection as never, 'SELECT * FROM c');

        const { text } = await invokeRegisteredTool(registerExecuteCurrentQueryTool, { queryContextId });
        const payload = JSON.parse(text);

        // The tool still returns useful metadata + an inferred schema.
        expect(payload.documentCount).toBe(2);
        expect(payload.schema).toBeDefined();

        // No value-derived statistic keys anywhere in the payload.
        expect(findConfidentialStatKeys(payload)).toEqual([]);
        // The actual sensitive numeric value must not appear anywhere in the serialized result.
        expect(text).not.toContain('987654');

        // Structural information is preserved so the schema remains useful to the model.
        const props = payload.schema.properties as Record<string, unknown>;
        expect(Object.keys(props)).toEqual(expect.arrayContaining(['salary', 'nationalId', 'active']));
    });
});

/**
 * A minimal QueryEditorTab stub whose `getCurrentQuery` reflects the mutable `query` field, so a
 * test can simulate the user editing the query between `prepareInvocation` and `invoke`.
 */
function makeTab(id: string, query: string, connection: unknown) {
    const tab = {
        query,
        getId: () => id,
        getSelectedQuery: () => undefined,
        getCurrentQuery: () => tab.query,
        connection,
        runActiveQueryInEditor: vi.fn(
            async (
                _query: string,
                _connection: { endpoint: string; databaseId: string; containerId: string },
                _token: vscode.CancellationToken,
            ): Promise<string | undefined> => 'exec-1',
        ),
        getCurrentQueryResults: vi.fn(() => ({
            documents: [],
            requestCharge: 1,
            roundTrips: 1,
            hasMoreResults: false,
        })),
    };
    return tab;
}

function setOpenTabs(queryEditorTab: { openTabs: Set<unknown> }, tabs: unknown[]): void {
    queryEditorTab.openTabs.clear();
    for (const tab of tabs) {
        queryEditorTab.openTabs.add(tab);
    }
}

const noopToken = { isCancellationRequested: false } as never;

function createContext(tab: ReturnType<typeof makeTab>): string {
    return createQueryExecutionContext(tab as never, tab.connection as never, tab.query);
}

describe('cosmosdb_executeCurrentQuery — confirmation snapshot (P1)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('runs the confirmed tab, not the now-active tab, after a tab switch', async () => {
        const { getActiveQueryEditor, getConnectionFromQueryTab } = await import('./chatUtils');
        const { QueryEditorTab } = await import('../panels/QueryEditorTab');

        const connA = { endpoint: 'https://a.documents.azure.com/', databaseId: 'dbA', containerId: 'cA' };
        const connB = { endpoint: 'https://b.documents.azure.com/', databaseId: 'dbB', containerId: 'cB' };
        const tabA = makeTab('A', 'SELECT * FROM a', connA);
        const tabB = makeTab('B', 'SELECT * FROM b', connB);
        setOpenTabs(QueryEditorTab as unknown as { openTabs: Set<unknown> }, [tabA, tabB]);

        vi.mocked(getConnectionFromQueryTab).mockImplementation(
            ((tab: unknown) => (tab as typeof tabA).connection) as never,
        );
        // Active tab while the confirmation prompt is built is A.
        vi.mocked(getActiveQueryEditor).mockReturnValue(tabA as never);

        const tool = captureRegisteredTool(registerExecuteCurrentQueryTool);
        const queryContextId = createContext(tabA);
        tool.prepareInvocation?.({ input: { queryContextId } }, noopToken);

        // User switches to tab B while the prompt is open; the active editor is now B.
        vi.mocked(getActiveQueryEditor).mockReturnValue(tabB as never);

        const result = await tool.invoke({ input: { queryContextId } }, noopToken);
        const payload = JSON.parse(serializeToolResult(result));

        // The confirmed tab A ran; the now-active tab B did not.
        expect(tabA.runActiveQueryInEditor).toHaveBeenCalledWith('SELECT * FROM a', connA, noopToken);
        expect(tabB.runActiveQueryInEditor).not.toHaveBeenCalled();
        expect(payload.databaseId).toBe('dbA');
        expect(payload.containerId).toBe('cA');
    });

    it('does not run an edited query after confirmation and asks to re-confirm', async () => {
        const { getActiveQueryEditor, getConnectionFromQueryTab } = await import('./chatUtils');
        const { QueryEditorTab } = await import('../panels/QueryEditorTab');

        const connA = { endpoint: 'https://a.documents.azure.com/', databaseId: 'dbA', containerId: 'cA' };
        const tabA = makeTab('A', 'SELECT * FROM a', connA);
        setOpenTabs(QueryEditorTab as unknown as { openTabs: Set<unknown> }, [tabA]);

        vi.mocked(getConnectionFromQueryTab).mockImplementation(
            ((tab: unknown) => (tab as typeof tabA).connection) as never,
        );
        vi.mocked(getActiveQueryEditor).mockReturnValue(tabA as never);

        const tool = captureRegisteredTool(registerExecuteCurrentQueryTool);
        const queryContextId = createContext(tabA);
        tool.prepareInvocation?.({ input: { queryContextId } }, noopToken);

        // User edits the query while the confirmation prompt is open.
        tabA.query = 'SELECT * FROM a WHERE secret = 1';

        const result = await tool.invoke({ input: { queryContextId } }, noopToken);
        const text = serializeToolResult(result);

        expect(tabA.runActiveQueryInEditor).not.toHaveBeenCalled();
        expect(text).toContain('changed after you confirmed');
    });

    it('runs the query when the editor is unchanged since confirmation', async () => {
        const { getActiveQueryEditor, getConnectionFromQueryTab } = await import('./chatUtils');
        const { QueryEditorTab } = await import('../panels/QueryEditorTab');

        const connA = { endpoint: 'https://a.documents.azure.com/', databaseId: 'dbA', containerId: 'cA' };
        const tabA = makeTab('A', 'SELECT * FROM a', connA);
        setOpenTabs(QueryEditorTab as unknown as { openTabs: Set<unknown> }, [tabA]);

        vi.mocked(getConnectionFromQueryTab).mockImplementation(
            ((tab: unknown) => (tab as typeof tabA).connection) as never,
        );
        vi.mocked(getActiveQueryEditor).mockReturnValue(tabA as never);

        const tool = captureRegisteredTool(registerExecuteCurrentQueryTool);
        const queryContextId = createContext(tabA);
        tool.prepareInvocation?.({ input: { queryContextId } }, noopToken);

        const result = await tool.invoke({ input: { queryContextId } }, noopToken);
        const payload = JSON.parse(serializeToolResult(result));

        expect(tabA.runActiveQueryInEditor).toHaveBeenCalledWith('SELECT * FROM a', connA, noopToken);
        expect(payload.databaseId).toBe('dbA');
    });

    it('keeps overlapping confirmations and out-of-order executions isolated', async () => {
        const { getConnectionFromQueryTab } = await import('./chatUtils');
        const { QueryEditorTab } = await import('../panels/QueryEditorTab');

        const connA = { endpoint: 'https://a.documents.azure.com/', databaseId: 'dbA', containerId: 'cA' };
        const connB = { endpoint: 'https://b.documents.azure.com/', databaseId: 'dbB', containerId: 'cB' };
        const tabA = makeTab('A', 'SELECT * FROM a', connA);
        const tabB = makeTab('B', 'SELECT * FROM b', connB);
        setOpenTabs(QueryEditorTab as unknown as { openTabs: Set<unknown> }, [tabA, tabB]);
        vi.mocked(getConnectionFromQueryTab).mockImplementation(
            ((tab: unknown) => (tab as typeof tabA).connection) as never,
        );

        let resolveA: ((executionId: string) => void) | undefined;
        let resolveB: ((executionId: string) => void) | undefined;
        tabA.runActiveQueryInEditor.mockImplementation(
            () => new Promise((resolve) => (resolveA = resolve as (executionId: string) => void)),
        );
        tabB.runActiveQueryInEditor.mockImplementation(
            () => new Promise((resolve) => (resolveB = resolve as (executionId: string) => void)),
        );
        tabA.getCurrentQueryResults.mockImplementation((executionId?: string) => ({
            documents: [],
            requestCharge: executionId === 'exec-a' ? 1 : 99,
            roundTrips: 1,
            hasMoreResults: false,
        }));
        tabB.getCurrentQueryResults.mockImplementation((executionId?: string) => ({
            documents: [],
            requestCharge: executionId === 'exec-b' ? 2 : 99,
            roundTrips: 1,
            hasMoreResults: false,
        }));

        const contextA = createContext(tabA);
        const contextB = createContext(tabB);
        const tool = captureRegisteredTool(registerExecuteCurrentQueryTool);
        tool.prepareInvocation?.({ input: { queryContextId: contextA } }, noopToken);
        tool.prepareInvocation?.({ input: { queryContextId: contextB } }, noopToken);

        const resultA = tool.invoke({ input: { queryContextId: contextA } }, noopToken);
        const resultB = tool.invoke({ input: { queryContextId: contextB } }, noopToken);
        resolveB?.('exec-b');
        resolveA?.('exec-a');

        const [payloadA, payloadB] = await Promise.all([resultA, resultB]).then((results) =>
            results.map((result) => JSON.parse(serializeToolResult(result))),
        );

        expect(tabA.runActiveQueryInEditor).toHaveBeenCalledWith('SELECT * FROM a', connA, noopToken);
        expect(tabB.runActiveQueryInEditor).toHaveBeenCalledWith('SELECT * FROM b', connB, noopToken);
        expect(tabA.getCurrentQueryResults).toHaveBeenCalledWith('exec-a');
        expect(tabB.getCurrentQueryResults).toHaveBeenCalledWith('exec-b');
        expect(payloadA).toMatchObject({ databaseId: 'dbA', containerId: 'cA', requestCharge: 1 });
        expect(payloadB).toMatchObject({ databaseId: 'dbB', containerId: 'cB', requestCharge: 2 });
    });

    it('keeps overlapping executions in the same tab correlated with their own results', async () => {
        const { getConnectionFromQueryTab } = await import('./chatUtils');
        const { QueryEditorTab } = await import('../panels/QueryEditorTab');

        const connection = { endpoint: 'https://a.documents.azure.com/', databaseId: 'dbA', containerId: 'cA' };
        const tab = makeTab('A', 'SELECT * FROM a', connection);
        setOpenTabs(QueryEditorTab as unknown as { openTabs: Set<unknown> }, [tab]);
        vi.mocked(getConnectionFromQueryTab).mockReturnValue(connection as never);

        let resolveFirst: ((executionId: string) => void) | undefined;
        let resolveSecond: ((executionId: string) => void) | undefined;
        tab.runActiveQueryInEditor
            .mockImplementationOnce(
                () => new Promise((resolve) => (resolveFirst = resolve as (executionId: string) => void)),
            )
            .mockImplementationOnce(
                () => new Promise((resolve) => (resolveSecond = resolve as (executionId: string) => void)),
            );
        tab.getCurrentQueryResults.mockImplementation((executionId?: string) => ({
            documents: [],
            requestCharge: executionId === 'exec-first' ? 1 : 2,
            roundTrips: 1,
            hasMoreResults: false,
        }));

        const firstContext = createContext(tab);
        const secondContext = createContext(tab);
        const tool = captureRegisteredTool(registerExecuteCurrentQueryTool);
        const firstResult = tool.invoke({ input: { queryContextId: firstContext } }, noopToken);
        const secondResult = tool.invoke({ input: { queryContextId: secondContext } }, noopToken);

        resolveSecond?.('exec-second');
        resolveFirst?.('exec-first');

        const [firstPayload, secondPayload] = await Promise.all([firstResult, secondResult]).then((results) =>
            results.map((result) => JSON.parse(serializeToolResult(result))),
        );

        expect(tab.getCurrentQueryResults).toHaveBeenCalledWith('exec-first');
        expect(tab.getCurrentQueryResults).toHaveBeenCalledWith('exec-second');
        expect(firstPayload.requestCharge).toBe(1);
        expect(secondPayload.requestCharge).toBe(2);
    });

    it('rejects replaying a consumed query context', async () => {
        const { getConnectionFromQueryTab } = await import('./chatUtils');
        const { QueryEditorTab } = await import('../panels/QueryEditorTab');

        const connection = { endpoint: 'https://a.documents.azure.com/', databaseId: 'dbA', containerId: 'cA' };
        const tab = makeTab('A', 'SELECT * FROM a', connection);
        setOpenTabs(QueryEditorTab as unknown as { openTabs: Set<unknown> }, [tab]);
        vi.mocked(getConnectionFromQueryTab).mockReturnValue(connection as never);

        const queryContextId = createContext(tab);
        const tool = captureRegisteredTool(registerExecuteCurrentQueryTool);
        await tool.invoke({ input: { queryContextId } }, noopToken);
        const replay = await tool.invoke({ input: { queryContextId } }, noopToken);

        expect(tab.runActiveQueryInEditor).toHaveBeenCalledTimes(1);
        expect(serializeToolResult(replay)).toContain('no longer available');
    });

    it('propagates cancellation requested while the query is running', async () => {
        const { getConnectionFromQueryTab } = await import('./chatUtils');
        const { QueryEditorTab } = await import('../panels/QueryEditorTab');

        const connection = { endpoint: 'https://a.documents.azure.com/', databaseId: 'dbA', containerId: 'cA' };
        const tab = makeTab('A', 'SELECT * FROM a', connection);
        setOpenTabs(QueryEditorTab as unknown as { openTabs: Set<unknown> }, [tab]);
        vi.mocked(getConnectionFromQueryTab).mockReturnValue(connection as never);
        tab.runActiveQueryInEditor.mockImplementation(
            (_query, _connection, token) =>
                new Promise<string | undefined>((resolve) => token.onCancellationRequested(() => resolve(undefined))),
        );

        const queryContextId = createContext(tab);
        const tool = captureRegisteredTool(registerExecuteCurrentQueryTool);
        const cts = new vscode.CancellationTokenSource();
        const result = tool.invoke({ input: { queryContextId } }, cts.token);
        cts.cancel();

        expect(serializeToolResult(await result)).toBe('Operation cancelled.');
        expect(tab.getCurrentQueryResults).not.toHaveBeenCalled();
    });
});
