/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { findConfidentialStatKeys } from '../services/schemaStatisticsTestUtils';
import { registerExecuteCurrentQueryTool } from './executeCurrentQueryTool';
import { invokeRegisteredTool } from './queryEditorToolTestUtils';

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
