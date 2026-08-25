/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { findConfidentialStatKeys } from '../services/schemaStatisticsTestUtils';
import { registerExecuteCurrentQueryTool } from './executeCurrentQueryTool';
import { captureRegisteredTool, invokeRegisteredTool, serializeToolResult } from './queryEditorToolTestUtils';

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
        const { getActiveQueryEditor, getConnectionFromQueryTab } = await import('./chatUtils');

        const tab = {
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
        vi.mocked(getActiveQueryEditor).mockReturnValue(tab as never);
        vi.mocked(getConnectionFromQueryTab).mockReturnValue({
            endpoint: 'https://example.documents.azure.com/',
            databaseId: 'db1',
            containerId: 'c1',
        } as never);

        const { text } = await invokeRegisteredTool(registerExecuteCurrentQueryTool);
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
        runActiveQueryInEditor: vi.fn(async () => 'exec-1'),
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
        tool.prepareInvocation?.({ input: {} }, noopToken);

        // User switches to tab B while the prompt is open; the active editor is now B.
        vi.mocked(getActiveQueryEditor).mockReturnValue(tabB as never);

        const result = await tool.invoke({ input: {} }, noopToken);
        const payload = JSON.parse(serializeToolResult(result));

        // The confirmed tab A ran; the now-active tab B did not.
        expect(tabA.runActiveQueryInEditor).toHaveBeenCalledWith('SELECT * FROM a');
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
        tool.prepareInvocation?.({ input: {} }, noopToken);

        // User edits the query while the confirmation prompt is open.
        tabA.query = 'SELECT * FROM a WHERE secret = 1';

        const result = await tool.invoke({ input: {} }, noopToken);
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
        tool.prepareInvocation?.({ input: {} }, noopToken);

        const result = await tool.invoke({ input: {} }, noopToken);
        const payload = JSON.parse(serializeToolResult(result));

        expect(tabA.runActiveQueryInEditor).toHaveBeenCalledWith('SELECT * FROM a');
        expect(payload.databaseId).toBe('dbA');
    });
});
