/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as vscode from 'vscode';
import { type NoSqlQueryConnection } from '../cosmosdb/NoSqlQueryConnection';
import { findConfidentialStatKeys } from '../services/schemaStatisticsTestUtils';
import { createContainerSampleContext } from './containerSampleContext';
import { captureRegisteredTool, serializeToolResult } from './queryEditorToolTestUtils';
import { registerSampleDataTool, sampleAndPersistContainerSchema } from './sampleDataTool';

// `sampleAndPersistContainerSchema` exercises the real `getSchemaFromDocuments` /
// `stripSchemaStatistics` helpers. Mock only the heavy siblings (Cosmos client, schema analyzer
// service) so the confidentiality boundary can be asserted deterministically.
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

vi.mock('@vscode/l10n', () => ({ t: (message: string) => message }));

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

const mergeDocumentsIntoSchema = vi.fn();
const getSimplifiedSchema = vi.fn();

vi.mock('../services/SchemaService', () => ({
    SchemaService: {
        getInstance: () => ({ mergeDocumentsIntoSchema, getSimplifiedSchema }),
    },
}));

const fetchAll = vi.fn();
const querySpy = vi.fn((_query?: string, _options?: { abortSignal?: AbortSignal }) => ({ fetchAll }));

vi.mock('../cosmosdb/getCosmosClient', () => ({
    getCosmosClient: () => ({
        database: () => ({
            container: () => ({
                items: { query: querySpy },
            }),
        }),
    }),
}));

const connection = { databaseId: 'db1', containerId: 'c1' } as NoSqlQueryConnection;

// Documents with confidential values (numeric extremes, string lengths) that `getSchemaFromDocuments`
// records as `x-minValue` / `x-maxValue` / `x-minLength` / `x-maxLength` statistics.
const sampleDocuments = [
    { id: '1', salary: 987654, nationalId: 'AB-123456789', active: true },
    { id: '2', salary: 42, nationalId: 'CD-9', active: false },
];

describe('sampleAndPersistContainerSchema — confidentiality boundary', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        fetchAll.mockResolvedValue({ resources: sampleDocuments, requestCharge: 1.23 });
        vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
            get: () => false,
        } as never);
    });

    it('strips value-derived statistics from the fallback schema when persistence fails', async () => {
        mergeDocumentsIntoSchema.mockRejectedValue(new Error('disk full'));

        const result = await sampleAndPersistContainerSchema(connection);

        expect(mergeDocumentsIntoSchema).toHaveBeenCalledOnce();
        // Persistence failed, so the raw inferred schema is the one serialized to the model.
        expect(findConfidentialStatKeys(result.schema)).toEqual([]);
        expect(JSON.stringify(result)).not.toContain('987654');

        // Structural information is preserved so the schema stays useful to the model.
        const props = (result.schema as { properties?: Record<string, unknown> }).properties ?? {};
        expect(Object.keys(props)).toEqual(expect.arrayContaining(['salary', 'nationalId', 'active']));
    });

    it('strips value-derived statistics from the fallback schema when getSimplifiedSchema returns nothing', async () => {
        mergeDocumentsIntoSchema.mockResolvedValue(undefined);
        getSimplifiedSchema.mockResolvedValue(undefined);

        const result = await sampleAndPersistContainerSchema(connection);

        expect(getSimplifiedSchema).toHaveBeenCalledOnce();
        expect(findConfidentialStatKeys(result.schema)).toEqual([]);
        expect(JSON.stringify(result)).not.toContain('987654');
    });

    it('passes an abort signal to the Cosmos query and aborts when the token is already cancelled', async () => {
        const cts = new vscode.CancellationTokenSource();
        cts.cancel();

        await sampleAndPersistContainerSchema(connection, cts.token);
        cts.dispose();

        const options = querySpy.mock.calls[0]?.[1];
        expect(options?.abortSignal).toBeInstanceOf(AbortSignal);
        expect(options?.abortSignal?.aborted).toBe(true);
    });
});

/**
 * A minimal QueryEditorTab stub whose id/connection are fixed, used to exercise the sample tool's
 * context pinning (confirm one container, sample exactly that one even after a tab switch).
 */
function makeTab(id: string, tabConnection: unknown) {
    return {
        getId: () => id,
        reveal: vi.fn(),
        connection: tabConnection,
    };
}

function setOpenTabs(queryEditorTab: { openTabs: Set<unknown> }, tabs: unknown[]): void {
    queryEditorTab.openTabs.clear();
    for (const tab of tabs) {
        queryEditorTab.openTabs.add(tab);
    }
}

const noopToken = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) } as never;

describe('cosmosdb_sampleContainerSchema — sample context (pinning)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        fetchAll.mockResolvedValue({ resources: sampleDocuments, requestCharge: 1.23 });
        mergeDocumentsIntoSchema.mockResolvedValue(undefined);
        getSimplifiedSchema.mockResolvedValue(undefined);
        vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({ get: () => false } as never);
    });

    it('samples the confirmed container and reveals its tab, not the now-active tab', async () => {
        const { getConnectionFromQueryTab } = await import('./chatUtils');
        const { QueryEditorTab } = await import('../panels/QueryEditorTab');

        const connA = { endpoint: 'https://a.documents.azure.com/', databaseId: 'dbA', containerId: 'cA' };
        const connB = { endpoint: 'https://b.documents.azure.com/', databaseId: 'dbB', containerId: 'cB' };
        const tabA = makeTab('A', connA);
        const tabB = makeTab('B', connB);
        setOpenTabs(QueryEditorTab as unknown as { openTabs: Set<unknown> }, [tabA, tabB]);
        vi.mocked(getConnectionFromQueryTab).mockImplementation(
            ((tab: unknown) => (tab as typeof tabA).connection) as never,
        );

        const sampleContextId = createContainerSampleContext(tabA as never, connA as never);
        const tool = captureRegisteredTool(registerSampleDataTool);
        const result = await tool.invoke({ input: { sampleContextId } }, noopToken);
        const payload = JSON.parse(serializeToolResult(result));

        expect(tabA.reveal).toHaveBeenCalledOnce();
        expect(tabB.reveal).not.toHaveBeenCalled();
        expect(payload.databaseId).toBe('dbA');
        expect(payload.containerId).toBe('cA');
    });

    it('does not sample when the connection drifted after confirmation', async () => {
        const { getConnectionFromQueryTab } = await import('./chatUtils');
        const { QueryEditorTab } = await import('../panels/QueryEditorTab');

        const confirmed = { endpoint: 'https://a.documents.azure.com/', databaseId: 'dbA', containerId: 'cA' };
        const drifted = { endpoint: 'https://a.documents.azure.com/', databaseId: 'dbA', containerId: 'cOTHER' };
        const tabA = makeTab('A', drifted);
        setOpenTabs(QueryEditorTab as unknown as { openTabs: Set<unknown> }, [tabA]);
        vi.mocked(getConnectionFromQueryTab).mockReturnValue(drifted as never);

        const sampleContextId = createContainerSampleContext(tabA as never, confirmed as never);
        const tool = captureRegisteredTool(registerSampleDataTool);
        const result = await tool.invoke({ input: { sampleContextId } }, noopToken);

        expect(serializeToolResult(result)).toContain('changed after you confirmed');
        expect(tabA.reveal).not.toHaveBeenCalled();
        expect(fetchAll).not.toHaveBeenCalled();
    });

    it('rejects an invalid or already-consumed sample context', async () => {
        const { getConnectionFromQueryTab } = await import('./chatUtils');
        const { QueryEditorTab } = await import('../panels/QueryEditorTab');

        const connA = { endpoint: 'https://a.documents.azure.com/', databaseId: 'dbA', containerId: 'cA' };
        const tabA = makeTab('A', connA);
        setOpenTabs(QueryEditorTab as unknown as { openTabs: Set<unknown> }, [tabA]);
        vi.mocked(getConnectionFromQueryTab).mockReturnValue(connA as never);

        const sampleContextId = createContainerSampleContext(tabA as never, connA as never);
        const tool = captureRegisteredTool(registerSampleDataTool);

        await tool.invoke({ input: { sampleContextId } }, noopToken);
        const replay = await tool.invoke({ input: { sampleContextId } }, noopToken);

        expect(fetchAll).toHaveBeenCalledTimes(1);
        expect(serializeToolResult(replay)).toContain('no longer available');
    });

    it('does not sample when the invocation is already cancelled', async () => {
        const { getConnectionFromQueryTab } = await import('./chatUtils');
        const { QueryEditorTab } = await import('../panels/QueryEditorTab');

        const connA = { endpoint: 'https://a.documents.azure.com/', databaseId: 'dbA', containerId: 'cA' };
        const tabA = makeTab('A', connA);
        setOpenTabs(QueryEditorTab as unknown as { openTabs: Set<unknown> }, [tabA]);
        vi.mocked(getConnectionFromQueryTab).mockReturnValue(connA as never);

        const sampleContextId = createContainerSampleContext(tabA as never, connA as never);
        const tool = captureRegisteredTool(registerSampleDataTool);
        const cts = new vscode.CancellationTokenSource();
        cts.cancel();

        const result = await tool.invoke({ input: { sampleContextId } }, cts.token);
        cts.dispose();

        expect(serializeToolResult(result)).toBe('Operation cancelled.');
        expect(tabA.reveal).not.toHaveBeenCalled();
        expect(fetchAll).not.toHaveBeenCalled();
    });
});
