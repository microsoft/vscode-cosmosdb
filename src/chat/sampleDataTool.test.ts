/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as vscode from 'vscode';
import { type NoSqlQueryConnection } from '../cosmosdb/NoSqlQueryConnection';
import { findConfidentialStatKeys } from '../services/schemaStatisticsTestUtils';
import { sampleAndPersistContainerSchema } from './sampleDataTool';

// `sampleAndPersistContainerSchema` exercises the real `getSchemaFromDocuments` /
// `stripSchemaStatistics` helpers. Mock only the heavy siblings (Cosmos client, schema analyzer
// service) so the confidentiality boundary can be asserted deterministically.
vi.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: vi.fn(),
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

vi.mock('../cosmosdb/getCosmosClient', () => ({
    getCosmosClient: () => ({
        database: () => ({
            container: () => ({
                items: { query: () => ({ fetchAll }) },
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
});
