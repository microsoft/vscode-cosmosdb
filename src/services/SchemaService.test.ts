/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type JSONSchema } from '@cosmosdb/schema-analyzer';
import * as crypto from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { type NoSqlQueryConnection } from '../cosmosdb/NoSqlQueryConnection';
import { type SchemaMetadata } from './SchemaFileStorage';
import type * as SchemaFileStorageModule from './SchemaFileStorage';
import { type SchemaWriteOptions } from './SchemaService';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const outputChannel = {
    appendLog: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
};

vi.mock('../extensionVariables', () => ({
    ext: {
        outputChannel,
        context: {
            globalState: {
                get: vi.fn(),
                update: vi.fn(),
                keys: vi.fn(() => []),
            },
        },
    },
}));

// Make `callWithTelemetryAndErrorHandling` synchronously invoke the callback
// with a stub action context. That way fire-and-forget telemetry code paths
// still run end-to-end and we can assert on what they recorded.
vi.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: vi.fn(async (_event: string, callback: (ctx: unknown) => unknown) => {
        const ctx = {
            telemetry: { properties: {} as Record<string, string>, measurements: {} as Record<string, number> },
            errorHandling: { suppressDisplay: false },
        };
        return callback(ctx);
    }),
    parseError: (error: unknown) => ({ message: error instanceof Error ? error.message : String(error) }),
}));

// Stub the heavy Cosmos-client chain — only `generateAndSaveSchema` reaches
// for it, and that flow isn't exercised by these tests.
vi.mock('../cosmosdb/withClaimsChallengeHandling', () => ({
    withClaimsChallengeHandling: vi.fn(),
    isNoSqlQueryConnection: vi.fn(() => true),
}));

// In-memory stand-in for SchemaFileStorage. Mirrors only the bits the
// service uses; tests inspect/seed it directly when they need to.

class FakeStorage {
    public readonly schemas = new Map<string, string>();
    public readonly metadata = new Map<string, SchemaMetadata>();

    saveSchema = vi.fn(async (meta: SchemaMetadata, json: string) => {
        this.metadata.set(meta.id, { ...meta });
        this.schemas.set(meta.id, json);
    });
    readSchema = vi.fn(async (id: string) => this.schemas.get(id));
    getMetadata = vi.fn((id: string) => this.metadata.get(id));
    hasSchema = vi.fn((id: string) => this.metadata.has(id));
    deleteSchema = vi.fn(async (id: string) => {
        this.metadata.delete(id);
        this.schemas.delete(id);
    });
    findSchemasForContainer = vi.fn((endpoint: string, databaseId: string, containerId: string) =>
        Array.from(this.metadata.values()).filter(
            (m) => m.endpoint === endpoint && m.databaseId === databaseId && m.containerId === containerId,
        ),
    );
    findSchemasForDatabase = vi.fn((endpoint: string, databaseId: string) =>
        Array.from(this.metadata.values()).filter((m) => m.endpoint === endpoint && m.databaseId === databaseId),
    );
    getSchemaFileUri = vi.fn((id: string) => vscode.Uri.file(`C:/tmp/schemas/${id}.json`));
}

const fakeStorage = new FakeStorage();

vi.mock('./SchemaFileStorage', async () => {
    const actual = await vi.importActual<typeof SchemaFileStorageModule>('./SchemaFileStorage');
    return {
        ...actual,
        SchemaFileStorage: {
            getInstance: () => fakeStorage,
            getSchemaIdForConnection: actual.SchemaFileStorage.getSchemaIdForConnection,
        },
    };
});

// Imported after mocks so the service binds to the fakes above.
const { SchemaService, aggressivelySimplify, SCHEMA_SIZE_LIMIT_BYTES } = await import('./SchemaService');

// ─── Helpers ────────────────────────────────────────────────────────────────

const connection: NoSqlQueryConnection = {
    databaseId: 'db',
    containerId: 'container',
    endpoint: 'https://example.documents.azure.com:443/',
    credentials: [],
    isEmulator: false,
};

function expectedSchemaId(): string {
    // Mirror SchemaFileStorage.getSchemaIdForConnection — kept inline so the test
    // doesn't have to reach into the mocked module via dynamic require.
    const raw = `${connection.endpoint}/${connection.databaseId}/${connection.containerId}`;
    return crypto.createHash('sha256').update(raw).digest('hex');
}

beforeEach(() => {
    fakeStorage.schemas.clear();
    fakeStorage.metadata.clear();
    fakeStorage.saveSchema.mockClear();
    fakeStorage.readSchema.mockClear();
    fakeStorage.getMetadata.mockClear();
    fakeStorage.hasSchema.mockClear();
    fakeStorage.deleteSchema.mockClear();
    fakeStorage.findSchemasForContainer.mockClear();
    fakeStorage.findSchemasForDatabase.mockClear();
    outputChannel.appendLog.mockClear();
    outputChannel.warn.mockClear();
    outputChannel.info.mockClear();

    vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
        get: vi.fn(() => false),
        has: vi.fn(),
        inspect: vi.fn(),
        update: vi.fn(),
    } as unknown as vscode.WorkspaceConfiguration);
});

afterEach(() => {
    vi.restoreAllMocks();
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('SchemaService.readSchema / getMetadata', () => {
    it('returns null when no schema exists for the connection', async () => {
        const service = new SchemaService();
        await expect(service.readSchema(connection)).resolves.toBeNull();
        expect(service.getMetadata(connection)).toBeUndefined();
    });

    it('parses and returns the stored schema when present', async () => {
        const id = expectedSchemaId();
        const stored = { type: 'object', properties: { name: { type: 'string' } } };
        fakeStorage.metadata.set(id, {
            id,
            name: 'db/container',
            generatedAt: '2025-01-01T00:00:00.000Z',
            documentCount: '5',
        });
        fakeStorage.schemas.set(id, JSON.stringify(stored));

        const service = new SchemaService();
        await expect(service.readSchema(connection)).resolves.toEqual(stored);
        expect(service.getMetadata(connection)).toBeDefined();
    });
});

describe('SchemaService.mergeDocumentsIntoSchema', () => {
    const baseOptions: SchemaWriteOptions = {
        source: 'queryMerge',
        suppressNotification: true,
    };

    it('returns undefined when given an empty document batch', async () => {
        const service = new SchemaService();
        const result = await service.mergeDocumentsIntoSchema(connection, [], baseOptions);
        expect(result).toBeUndefined();
        expect(fakeStorage.saveSchema).not.toHaveBeenCalled();
    });

    it('bootstraps a schema from documents when none exists', async () => {
        const service = new SchemaService();

        const result = await service.mergeDocumentsIntoSchema(
            connection,
            [
                { id: '1', name: 'Alice' },
                { id: '2', name: 'Bob' },
            ],
            baseOptions,
        );

        expect(result).toBeDefined();
        expect(result!.documentsInspectedInWrite).toBe(2);
        expect(fakeStorage.saveSchema).toHaveBeenCalledOnce();

        const saved = fakeStorage.saveSchema.mock.calls[0][0];
        expect(saved.endpoint).toBe(connection.endpoint);
        expect(saved.databaseId).toBe(connection.databaseId);
        expect(saved.containerId).toBe(connection.containerId);
        expect(saved.documentCount).toBe('2');
        expect(saved.initialDocumentCount).toBe('2');
    });

    it('emits onSchemaChanged with the right payload after a save', async () => {
        const service = new SchemaService();
        const events: unknown[] = [];
        service.onSchemaChanged((e) => events.push(e));

        await service.mergeDocumentsIntoSchema(connection, [{ id: '1' }], baseOptions);

        expect(events).toEqual([
            {
                type: 'saved',
                endpoint: connection.endpoint,
                databaseId: connection.databaseId,
                containerId: connection.containerId,
                source: 'queryMerge',
            },
        ]);
    });

    it('freezes initialDocumentCount once updateFromQueriesEnabled flips on', async () => {
        const service = new SchemaService();

        // Seed an existing schema with a previous count of 100.
        const id = expectedSchemaId();
        fakeStorage.metadata.set(id, {
            id,
            name: 'db/container',
            generatedAt: '2025-01-01T00:00:00.000Z',
            documentCount: '100',
            initialDocumentCount: '100',
            endpoint: connection.endpoint,
            databaseId: connection.databaseId,
            containerId: connection.containerId,
        });
        fakeStorage.schemas.set(id, JSON.stringify({ type: 'object', properties: {} }));

        await service.mergeDocumentsIntoSchema(connection, [{ id: 'x' }, { id: 'y' }], {
            source: 'queryMerge',
            suppressNotification: true,
            updateFromQueriesEnabled: true,
        });

        const saved = fakeStorage.saveSchema.mock.calls[0][0];
        expect(saved.updatedFromQueries).toBe(true);
        // Document count is "frozen" at the pre-merge value (100); the +2 from
        // the incremental batch is intentionally not added.
        expect(saved.documentCount).toBe('100');
        expect(saved.initialDocumentCount).toBe('100');
    });
});

describe('SchemaService.deleteSchema', () => {
    function seedSchema(): string {
        const id = expectedSchemaId();
        fakeStorage.metadata.set(id, {
            id,
            name: 'db/container',
            generatedAt: '2025-01-01T00:00:00.000Z',
            documentCount: '10',
            endpoint: connection.endpoint,
            databaseId: connection.databaseId,
            containerId: connection.containerId,
        });
        fakeStorage.schemas.set(id, '{}');
        return id;
    }

    it('returns false when no schema exists for the connection', async () => {
        const service = new SchemaService();
        const ok = await service.deleteSchema(connection, { source: 'manualDelete', suppressNotification: true });
        expect(ok).toBe(false);
        expect(fakeStorage.deleteSchema).not.toHaveBeenCalled();
    });

    it('auto-cancels with suppressNotification when confirmAll is not set', async () => {
        const id = seedSchema();
        const service = new SchemaService();

        const ok = await service.deleteSchema(connection, {
            source: 'manualDelete',
            suppressNotification: true,
        });

        expect(ok).toBe(false);
        expect(fakeStorage.deleteSchema).not.toHaveBeenCalled();
        expect(fakeStorage.metadata.has(id)).toBe(true);
    });

    it('proceeds automatically when suppressNotification + confirmAll are both set', async () => {
        const id = seedSchema();
        const service = new SchemaService();
        const events: unknown[] = [];
        service.onSchemaChanged((e) => events.push(e));

        const ok = await service.deleteSchema(connection, {
            source: 'cascadeDelete',
            suppressNotification: true,
            confirmAll: true,
        });

        expect(ok).toBe(true);
        expect(fakeStorage.deleteSchema).toHaveBeenCalledWith(id);
        expect(events).toEqual([
            {
                type: 'deleted',
                endpoint: connection.endpoint,
                databaseId: connection.databaseId,
                containerId: connection.containerId,
                source: 'cascadeDelete',
            },
        ]);
    });

    it('asks for confirmation through the warning dialog when notifications are enabled', async () => {
        const id = seedSchema();
        const service = new SchemaService();
        const showWarning = vi
            .spyOn(vscode.window, 'showWarningMessage')
            .mockImplementation(
                (async (_message: string, _options: unknown, ...items: vscode.MessageItem[]) =>
                    items[0]) as unknown as typeof vscode.window.showWarningMessage,
            );

        const ok = await service.deleteSchema(connection, { source: 'manualDelete' });

        expect(showWarning).toHaveBeenCalled();
        expect(ok).toBe(true);
        expect(fakeStorage.deleteSchema).toHaveBeenCalledWith(id);
    });

    it('returns false when the user clicks Cancel in the dialog', async () => {
        const id = seedSchema();
        const service = new SchemaService();
        vi.spyOn(vscode.window, 'showWarningMessage').mockImplementation(
            (async (_message: string, _options: unknown, _confirm: vscode.MessageItem, cancel: vscode.MessageItem) =>
                cancel) as unknown as typeof vscode.window.showWarningMessage,
        );

        const ok = await service.deleteSchema(connection, { source: 'manualDelete' });

        expect(ok).toBe(false);
        expect(fakeStorage.deleteSchema).not.toHaveBeenCalled();
        expect(fakeStorage.metadata.has(id)).toBe(true);
    });
});

describe('SchemaService.deleteSchemasForContainer / Database', () => {
    function seed(containerId: string, databaseId = 'db'): SchemaMetadata {
        const meta: SchemaMetadata = {
            id: `${databaseId}-${containerId}`,
            name: `${databaseId}/${containerId}`,
            generatedAt: '2025-01-01T00:00:00.000Z',
            documentCount: '1',
            endpoint: connection.endpoint,
            databaseId,
            containerId,
        };
        fakeStorage.metadata.set(meta.id, meta);
        fakeStorage.schemas.set(meta.id, '{}');
        return meta;
    }

    it('removes only the matching container and emits onSchemaChanged for it', async () => {
        seed('c1');
        seed('c2');
        const service = new SchemaService();
        const events: { type: string; containerId: string; source: string }[] = [];
        service.onSchemaChanged((e) => events.push({ type: e.type, containerId: e.containerId, source: e.source }));

        await service.deleteSchemasForContainer(connection.endpoint, 'db', 'c1');

        expect(fakeStorage.metadata.has('db-c1')).toBe(false);
        expect(fakeStorage.metadata.has('db-c2')).toBe(true);
        expect(events).toEqual([{ type: 'deleted', containerId: 'c1', source: 'cascadeDelete' }]);
    });

    it('removes every container under the database and emits one event per match', async () => {
        seed('c1');
        seed('c2');
        seed('other', 'db2');
        const service = new SchemaService();
        const events: string[] = [];
        service.onSchemaChanged((e) => events.push(e.containerId));

        await service.deleteSchemasForDatabase(connection.endpoint, 'db');

        expect(fakeStorage.metadata.has('db-c1')).toBe(false);
        expect(fakeStorage.metadata.has('db-c2')).toBe(false);
        expect(fakeStorage.metadata.has('db2-other')).toBe(true);
        expect(events.sort()).toEqual(['c1', 'c2']);
    });

    it('does not throw when the underlying storage rejects — failures are logged', async () => {
        seed('c1');
        const service = new SchemaService();
        fakeStorage.deleteSchema.mockRejectedValueOnce(new Error('disk full'));

        await expect(service.deleteSchemasForContainer(connection.endpoint, 'db', 'c1')).resolves.toBeUndefined();
        expect(outputChannel.warn).toHaveBeenCalled();
    });
});

describe('SchemaService.getSimplifiedSchema', () => {
    it('returns null when no schema is stored for the connection', async () => {
        const service = new SchemaService();
        await expect(service.getSimplifiedSchema(connection)).resolves.toBeNull();
    });

    it('returns the stored schema unchanged when it is already under the target budget', async () => {
        const id = expectedSchemaId();
        const schema = { type: 'object', properties: { id: { type: 'string', 'x-occurrence': 100 } } };
        fakeStorage.metadata.set(id, {
            id,
            name: 'db/container',
            generatedAt: '2025-01-01T00:00:00.000Z',
            documentCount: '1',
        });
        fakeStorage.schemas.set(id, JSON.stringify(schema));

        const service = new SchemaService();
        const result = await service.getSimplifiedSchema(connection);

        expect(result).not.toBeNull();
        expect(result!.wasSimplified).toBe(false);
        expect(result!.originalSizeBytes).toBe(result!.simplifiedSizeBytes);
        expect(result!.schema.properties).toBeDefined();
    });

    it('prunes deep schemas down to the configured max depth', async () => {
        // Build a 6-level deep schema. With maxDepth = 2 and a 100-byte budget,
        // depth-cut should kick in once popularity-based cuts can't reach the target.
        const deep: JSONSchema = {
            type: 'object',
            properties: {
                a: {
                    type: 'object',
                    properties: {
                        b: {
                            type: 'object',
                            properties: {
                                c: {
                                    type: 'object',
                                    properties: {
                                        d: { type: 'object', properties: { e: { type: 'string' } } },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        };
        const id = expectedSchemaId();
        fakeStorage.metadata.set(id, {
            id,
            name: 'db/container',
            generatedAt: '2025-01-01T00:00:00.000Z',
            documentCount: '1',
        });
        fakeStorage.schemas.set(id, JSON.stringify(deep));

        const service = new SchemaService();
        const result = await service.getSimplifiedSchema(connection, {
            targetSizeBytes: 100,
            maxDepth: 2,
            keepTopN: 1,
        });

        expect(result).not.toBeNull();
        expect(result!.wasSimplified).toBe(true);
        expect(result!.simplifiedSizeBytes).toBeLessThan(result!.originalSizeBytes);

        // The top-level still exists but nothing below depth=2 should remain.
        const props = (result!.schema.properties ?? {}) as Record<string, JSONSchema>;
        expect(props.a).toBeDefined();
        const aProps = (props.a.properties ?? {}) as Record<string, JSONSchema>;
        // a/b is at depth 2 — its properties bag (depth 3 contents) must be empty.
        expect(aProps.b?.properties).toEqual({});
    });
});

describe('aggressivelySimplify (pure helper)', () => {
    it('strips noisy x-* statistics without touching popularity counters', () => {
        const schema: JSONSchema = {
            type: 'object',
            'x-occurrence': 10,
            'x-minProperties': 1,
            'x-maxProperties': 99,
            properties: { name: { type: 'string', 'x-occurrence': 10, 'x-minLength': 2 } },
        } as unknown as JSONSchema;

        const result = aggressivelySimplify(schema, {
            targetSizeBytes: 10 * 1024,
            maxDepth: 5,
            keepTopN: 2,
            popularityKey: 'x-occurrence',
        });

        const out = result.schema as unknown as Record<string, unknown>;
        expect(out['x-minProperties']).toBeUndefined();
        expect(out['x-maxProperties']).toBeUndefined();
        expect(out['x-occurrence']).toBe(10);
        const nameProp = (out.properties as Record<string, Record<string, unknown>>).name;
        expect(nameProp['x-minLength']).toBeUndefined();
        expect(nameProp['x-occurrence']).toBe(10);
    });

    it('keeps only the top-N most popular children when over budget', () => {
        // Popularity-based cut iterates from maxDepth down to 1 (never depth 0),
        // so nest the property bag one level deep to ensure the cut can fire.
        const schema: JSONSchema = {
            type: 'object',
            properties: {
                bag: {
                    type: 'object',
                    properties: {
                        hot: { type: 'string', 'x-occurrence': 1000 },
                        warm: { type: 'string', 'x-occurrence': 500 },
                        cold: { type: 'string', 'x-occurrence': 1 },
                        rare: { type: 'string', 'x-occurrence': 0 },
                    },
                },
            },
        } as unknown as JSONSchema;

        const result = aggressivelySimplify(schema, {
            targetSizeBytes: 120,
            maxDepth: 5,
            keepTopN: 2,
            popularityKey: 'x-occurrence',
        });

        const bag = (result.schema.properties as Record<string, JSONSchema>).bag;
        const props = Object.keys(bag.properties ?? {}).sort();
        expect(result.popularityKeyHit).toBe(true);
        expect(result.wasSimplified).toBe(true);
        expect(props).toEqual(['hot', 'warm']);
    });
});

describe('SchemaService constants', () => {
    it('caps persisted schemas at 5 MB', () => {
        expect(SCHEMA_SIZE_LIMIT_BYTES).toBe(5 * 1024 * 1024);
    });
});
