/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type JSONSchema } from '@cosmosdb/schema-analyzer';
import { getSchemaFromDocuments } from '@cosmosdb/schema-analyzer/json';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
// @ts-expect-error — plain ESM script with no .d.ts; the shape is documented in the script's JSDoc.
import { generateLargeSchemaDocuments, LARGE_SCHEMA_PRESETS } from '../../scripts/generate-large-schema-data.mjs';
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
// still run end-to-end, and we can assert on what they recorded.
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
const {
    SchemaService,
    aggressivelySimplify,
    composeMetadata,
    SCHEMA_SIZE_LIMIT_BYTES,
    DEFAULT_SIMPLIFIED_TARGET_BYTES,
} = await import('./SchemaService');

// Re-import the telemetry stub as a typed handle so the cascade-delete tests
// can assert on what was emitted without re-mocking the module.
const { callWithTelemetryAndErrorHandling: telemetryStub } =
    (await import('@microsoft/vscode-azext-utils')) as unknown as {
        callWithTelemetryAndErrorHandling: ReturnType<typeof vi.fn>;
    };

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
    telemetryStub.mockClear();

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

    // ── Telemetry regression ────────────────────────────────────────────
    // The earlier implementation fired one telemetry event per *match*
    // inside the delete loop and derived `scope` from `matches.length` —
    // i.e. a container delete that happened to find 2 stray legacy
    // entries would be reported as `'database'`. These tests pin both
    // properties.

    describe('cascadeDelete telemetry', () => {
        function captureTelemetryEvents() {
            const events: {
                event: string;
                properties: Record<string, string>;
                measurements: Record<string, number>;
            }[] = [];
            // Synchronous capture — the production cascade callback only
            // mutates ctx.telemetry.* (no awaited work), so reading the
            // properties immediately after invocation is safe and avoids
            // the `no-misused-promises` lint rule that fires on async
            // mock implementations.
            telemetryStub.mockImplementation((event: string, callback: (ctx: unknown) => unknown) => {
                const ctx = {
                    telemetry: { properties: {} as Record<string, string>, measurements: {} as Record<string, number> },
                    errorHandling: { suppressDisplay: false, rethrow: false },
                };
                const result = callback(ctx);
                events.push({
                    event,
                    properties: { ...ctx.telemetry.properties },
                    measurements: { ...ctx.telemetry.measurements },
                });
                return result;
            });
            return events;
        }

        it('fires exactly once per database cascade with scope="database" and deletedCount=N', async () => {
            seed('c1');
            seed('c2');
            seed('c3');
            const events = captureTelemetryEvents();

            await new SchemaService().deleteSchemasForDatabase(connection.endpoint, 'db');

            const cascadeEvents = events.filter((e) => e.event === 'cosmosDB.nosql.schema.cascadeDelete');
            expect(cascadeEvents).toHaveLength(1);
            expect(cascadeEvents[0].properties.scope).toBe('database');
            expect(cascadeEvents[0].measurements.deletedCount).toBe(3);
            expect(cascadeEvents[0].measurements.errorCount).toBe(0);
        });

        it('fires exactly once per container cascade with scope="container" even when multiple stray entries match', async () => {
            // Seed two legacy entries for the same container (e.g. a re-create)
            // — `findSchemasForContainer` returns both, but the *caller's*
            // intent is still a single container delete.
            seed('c1');
            const dup: SchemaMetadata = {
                id: 'db-c1-legacy',
                name: 'db/c1',
                generatedAt: '2024-01-01T00:00:00.000Z',
                documentCount: '1',
                endpoint: connection.endpoint,
                databaseId: 'db',
                containerId: 'c1',
            };
            fakeStorage.metadata.set(dup.id, dup);
            fakeStorage.schemas.set(dup.id, '{}');

            const events = captureTelemetryEvents();

            await new SchemaService().deleteSchemasForContainer(connection.endpoint, 'db', 'c1');

            const cascadeEvents = events.filter((e) => e.event === 'cosmosDB.nosql.schema.cascadeDelete');
            expect(cascadeEvents).toHaveLength(1);
            expect(cascadeEvents[0].properties.scope).toBe('container');
            expect(cascadeEvents[0].measurements.deletedCount).toBe(2);
        });

        it('records errorCount when individual deletes fail without aborting the cascade', async () => {
            seed('c1');
            seed('c2');
            fakeStorage.deleteSchema.mockRejectedValueOnce(new Error('transient'));
            const events = captureTelemetryEvents();

            await new SchemaService().deleteSchemasForDatabase(connection.endpoint, 'db');

            const cascadeEvents = events.filter((e) => e.event === 'cosmosDB.nosql.schema.cascadeDelete');
            expect(cascadeEvents).toHaveLength(1);
            expect(cascadeEvents[0].measurements.deletedCount).toBe(1);
            expect(cascadeEvents[0].measurements.errorCount).toBe(1);
        });

        it('does not fire when no matches exist', async () => {
            const events = captureTelemetryEvents();

            await new SchemaService().deleteSchemasForContainer(connection.endpoint, 'db', 'missing');

            const cascadeEvents = events.filter((e) => e.event === 'cosmosDB.nosql.schema.cascadeDelete');
            expect(cascadeEvents).toHaveLength(0);
        });
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
            rootKeepTopN: 50,
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
            rootKeepTopN: 50,
            popularityKey: 'x-occurrence',
        });

        const bag = (result.schema.properties as Record<string, JSONSchema>).bag;
        const props = Object.keys(bag.properties ?? {}).sort();
        expect(result.popularityKeyHit).toBe(true);
        expect(result.wasSimplified).toBe(true);
        expect(props).toEqual(['hot', 'warm']);
    });

    it('also trims the schema root when it is wide and flat (respects rootKeepTopN)', () => {
        // Wide, flat root with 50 unique top-level fields:
        //   - 3 "stable" fields with high occurrence
        //   - 47 "rare" fields with occurrence = 1 each (simulates polymorphic drift)
        // The pre-fix algorithm only iterated `depth >= 1`, so the root bag
        // was never touched.  This test pins the new behavior: with
        // `rootKeepTopN = 5`, the simplified root keeps exactly the 3 stable
        // fields plus 2 of the rare ones (chosen by stable insertion order).
        const properties: Record<string, JSONSchema> = {
            id: { type: 'string', 'x-occurrence': 1000 } as JSONSchema,
            _partitionKey: { type: 'string', 'x-occurrence': 1000 } as JSONSchema,
            status: { type: 'string', 'x-occurrence': 1000 } as JSONSchema,
        };
        for (let i = 0; i < 47; i++) {
            properties[`rare_${String(i).padStart(3, '0')}`] = { type: 'string', 'x-occurrence': 1 } as JSONSchema;
        }
        const schema: JSONSchema = { type: 'object', properties } as unknown as JSONSchema;

        const result = aggressivelySimplify(schema, {
            // Force the popularity loop to need a root trim by setting a tiny
            // budget — well under the size of even the trimmed shape — so the
            // loop has to escalate all the way to depth 0.
            targetSizeBytes: 100,
            maxDepth: 5,
            keepTopN: 2,
            rootKeepTopN: 5,
            popularityKey: 'x-occurrence',
        });

        const kept = Object.keys((result.schema.properties ?? {}) as Record<string, JSONSchema>).sort();
        expect(result.popularityKeyHit).toBe(true);
        expect(result.wasSimplified).toBe(true);
        expect(kept).toHaveLength(5);
        // All 3 stable fields survive — they're the top of the popularity rank.
        expect(kept).toEqual(expect.arrayContaining(['id', '_partitionKey', 'status']));
        // The other 2 slots are filled by *some* rare fields (stable sort
        // picks them by insertion order — `rare_000` and `rare_001`).
        expect(kept.filter((k) => k.startsWith('rare_'))).toEqual(['rare_000', 'rare_001']);
    });
});

describe('SchemaService constants', () => {
    it('caps persisted schemas at 5 MB', () => {
        expect(SCHEMA_SIZE_LIMIT_BYTES).toBe(5 * 1024 * 1024);
    });

    it('targets 50 KB for the AI-facing simplified schema', () => {
        // Lowered from 500 KB (~100 K tokens) so the schema never dominates
        // a model prompt.  Bump deliberately if you have evidence the smaller
        // schema is too lossy — and refresh the snapshots in __mocks__.
        expect(DEFAULT_SIMPLIFIED_TARGET_BYTES).toBe(50 * 1024);
    });
});

// ─── Snapshot tests against deterministically generated large schemas ───────
//
// Each preset feeds the seeded generator from
// `scripts/generate-large-schema-data.mjs` into the schema-analyzer, runs the
// production `aggressivelySimplify` with the live defaults, and compares the
// result against a JSON snapshot committed under `__mocks__/simplified-*.json`.
//
// To refresh the snapshots after intentionally changing simplification
// behavior, run:
//
//   npm run test -- src/services/SchemaService.test.ts -u
//
// The snapshots themselves act as a regression net: any unexpected drift in
// generation, schema inference, or simplification produces a diff in code
// review.
describe('aggressivelySimplify on generated large schemas', () => {
    const PRESETS: ReadonlyArray<{ name: 'small' | 'medium' | 'large'; targetMB: number; records: number }> = [
        { name: 'small', targetMB: LARGE_SCHEMA_PRESETS.small.targetMB, records: LARGE_SCHEMA_PRESETS.small.records },
        {
            name: 'medium',
            targetMB: LARGE_SCHEMA_PRESETS.medium.targetMB,
            records: LARGE_SCHEMA_PRESETS.medium.records,
        },
        { name: 'large', targetMB: LARGE_SCHEMA_PRESETS.large.targetMB, records: LARGE_SCHEMA_PRESETS.large.records },
    ];

    for (const preset of PRESETS) {
        it(
            `produces a stable simplified schema for preset "${preset.name}" (~${preset.targetMB} MB raw)`,
            { timeout: 120_000 },
            async () => {
                // 1. Deterministic documents from the shared generator.
                const { documents } = generateLargeSchemaDocuments({
                    targetMB: preset.targetMB,
                    recordCount: preset.records,
                    seed: 42,
                });

                // 2. Build the raw schema (this is the "input" to simplification).
                const rawSchema = getSchemaFromDocuments(documents);

                // 2a. Persist the raw schema next to the snapshot so a human
                //     can eyeball the input vs. the simplified output during
                //     review or debugging.  Raw artifacts live under
                //     `__mocks__/raw/`, which is gitignored — they're useful
                //     locally but too large (tens of MB for the large preset)
                //     to commit.  Failures to write here must never break the
                //     test: it's purely a developer convenience.
                try {
                    const rawDir = path.resolve(__dirname, '__mocks__/raw');
                    fs.mkdirSync(rawDir, { recursive: true });
                    fs.writeFileSync(
                        path.resolve(rawDir, `raw-${preset.name}.json`),
                        JSON.stringify(rawSchema, null, 2),
                        'utf8',
                    );
                } catch {
                    // Non-fatal — dev convenience only.
                }

                // 3. Simplify with the live production defaults so the snapshot
                //    captures the *current* contract of `aggressivelySimplify`.
                const rawBytes = Buffer.byteLength(JSON.stringify(rawSchema), 'utf8');
                const { schema: simplified, wasSimplified } = aggressivelySimplify(rawSchema, {
                    targetSizeBytes: DEFAULT_SIMPLIFIED_TARGET_BYTES,
                    maxDepth: 3,
                    keepTopN: 2,
                    rootKeepTopN: 50,
                    popularityKey: 'x-occurrence',
                });
                const simplifiedBytes = Buffer.byteLength(JSON.stringify(simplified), 'utf8');

                // 4. Sanity:
                //    a) Simplification always fires on these inputs.
                //    b) The output respects the configured byte budget — this
                //       is the whole point of the wide-flat regression: before
                //       `aggressivelySimplify` learned to trim the schema root
                //       it could produce outputs *megabytes* over the budget.
                expect(wasSimplified).toBe(true);
                expect(simplifiedBytes).toBeLessThanOrEqual(DEFAULT_SIMPLIFIED_TARGET_BYTES);
                expect(simplifiedBytes).toBeLessThan(rawBytes);

                // 5. Byte-for-byte snapshot. vitest writes the file on first run
                //    (or with `-u`) and asserts equality on every subsequent run.
                //    Trailing newline matches Prettier's default for `.json`
                //    files so a follow-up `npm run prettier-fix` doesn't drift
                //    the fixture out of sync with what the test produces.
                const fixturePath = path.resolve(__dirname, `__mocks__/simplified-${preset.name}.json`);
                await expect(JSON.stringify(simplified, null, 2) + '\n').toMatchFileSnapshot(fixturePath);
            },
        );
    }
});

// ─── Parameter sweeps — calibration of the production defaults ──────────────
//
// These tests pin the **size contract** of `aggressivelySimplify` for the
// settings we actually ship in production.  The point is twofold:
//   1. Prevent regressions: any future tweak to the algorithm that breaks
//      the "lands close to the byte budget" promise lights up here.
//   2. Calibration aid: if you're tuning new defaults, run this file with
//      different parameter values and the failure message tells you whether
//      the output is over-budget, under-utilized, or just right.
//
// The wide-flat schema fixture is intentionally pathological — it's the
// worst case the simplifier has to handle, so any settings that work here
// generally work for real-world schemas too.
describe('aggressivelySimplify lands close to the configured byte budget', () => {
    // Generate once and reuse — the small preset alone is ~3 MB of compact
    // JSON; building it for every parametrized case would multiply the
    // suite's runtime by ~10×.
    let rawSchema: JSONSchema;
    let rawBytes: number;

    beforeAll(() => {
        const { documents } = generateLargeSchemaDocuments({
            targetMB: LARGE_SCHEMA_PRESETS.small.targetMB,
            recordCount: LARGE_SCHEMA_PRESETS.small.records,
            seed: 42,
        });
        rawSchema = getSchemaFromDocuments(documents);
        rawBytes = Buffer.byteLength(JSON.stringify(rawSchema), 'utf8');
    });

    // ── Budget sweep ────────────────────────────────────────────────────
    //
    // Adaptive root trim makes `targetSizeBytes` the dominant size lever:
    // we binary-search the largest cut that still fits, so the output
    // should consistently land *just under* the budget across orders of
    // magnitude.
    //
    // Tolerance is asymmetric on purpose:
    //   - Hard upper bound at `targetKB` (the budget is a contract).
    //   - Lower bound `targetKB - toleranceKB`: makes sure we're actually
    //     *using* the budget, not throwing schema information away for free.
    const BUDGET_CASES: ReadonlyArray<{ targetKB: number; toleranceKB: number }> = [
        { targetKB: 25, toleranceKB: 5 },
        { targetKB: 50, toleranceKB: 10 },
        { targetKB: 100, toleranceKB: 15 },
        { targetKB: 250, toleranceKB: 25 },
    ];

    for (const { targetKB, toleranceKB } of BUDGET_CASES) {
        it(`targetSizeBytes = ${targetKB} KB → output lands at ${targetKB} ± ${toleranceKB} KB`, () => {
            const targetBytes = targetKB * 1024;
            const tolBytes = toleranceKB * 1024;

            const { schema, wasSimplified } = aggressivelySimplify(rawSchema, {
                targetSizeBytes: targetBytes,
                maxDepth: 3,
                keepTopN: 2,
                rootKeepTopN: 50,
                popularityKey: 'x-occurrence',
            });
            const outBytes = Buffer.byteLength(JSON.stringify(schema), 'utf8');

            expect(wasSimplified).toBe(true);
            // Budget is a hard upper bound — never overshoot.
            expect(outBytes).toBeLessThanOrEqual(targetBytes);
            // …and we should sit *within tolerance* of the budget, not far below.
            // If this fails low it means the algorithm under-utilizes the budget.
            expect(outBytes).toBeGreaterThanOrEqual(targetBytes - tolBytes);
            // Sanity: still meaningfully smaller than the raw input.
            expect(outBytes).toBeLessThan(rawBytes);
        });
    }

    // ── rootKeepTopN floor sweep ────────────────────────────────────────
    //
    // `rootKeepTopN` is a *minimum* (floor) — there are two distinct
    // contracts depending on whether the budget has room above the floor:
    //
    //   - **Budget-driven**: keeping just `rootKeepTopN` entries fits the
    //     budget comfortably, so the adaptive trim grows the root above
    //     the floor to use the byte budget.  Final root count >> floor.
    //
    //   - **Floor-driven**: keeping `rootKeepTopN` entries already exceeds
    //     the budget, so the simplifier honors the floor and accepts a
    //     slight budget overflow.  Final root count ≈ floor.
    //
    // Each contract is exercised in its own `describe` block so the
    // assertions stay unconditional (oxlint rule `no-conditional-expect`).

    describe('rootKeepTopN floor — budget-driven cases', () => {
        const BUDGET_DRIVEN_CASES: ReadonlyArray<{ rootKeepTopN: number; targetKB: number }> = [
            { rootKeepTopN: 5, targetKB: 50 },
            { rootKeepTopN: 50, targetKB: 50 },
            { rootKeepTopN: 200, targetKB: 50 },
        ];

        for (const { rootKeepTopN, targetKB } of BUDGET_DRIVEN_CASES) {
            it(`rootKeepTopN = ${rootKeepTopN}, targetSizeBytes = ${targetKB} KB → root grows above the floor`, () => {
                const targetBytes = targetKB * 1024;
                const { schema } = aggressivelySimplify(rawSchema, {
                    targetSizeBytes: targetBytes,
                    maxDepth: 3,
                    keepTopN: 2,
                    rootKeepTopN,
                    popularityKey: 'x-occurrence',
                });
                const outBytes = Buffer.byteLength(JSON.stringify(schema), 'utf8');
                const rootCount = Object.keys(schema.properties ?? {}).length;

                // Adaptive grew the root above the floor to fit the budget.
                expect(outBytes).toBeLessThanOrEqual(targetBytes);
                expect(rootCount).toBeGreaterThan(rootKeepTopN);
            });
        }
    });

    describe('rootKeepTopN floor — floor-driven case', () => {
        // Keeping 500 root entries already exceeds the 5 KB budget on our
        // fixture, so the simplifier honors the floor and lets the budget
        // overflow rather than stripping the schema below the contract.
        const rootKeepTopN = 500;
        const targetKB = 5;

        it(`rootKeepTopN = ${rootKeepTopN}, targetSizeBytes = ${targetKB} KB → floor wins, budget overflows`, () => {
            const targetBytes = targetKB * 1024;
            const { schema } = aggressivelySimplify(rawSchema, {
                targetSizeBytes: targetBytes,
                maxDepth: 3,
                keepTopN: 2,
                rootKeepTopN,
                popularityKey: 'x-occurrence',
            });
            const outBytes = Buffer.byteLength(JSON.stringify(schema), 'utf8');
            const rootCount = Object.keys(schema.properties ?? {}).length;

            expect(rootCount).toBeGreaterThanOrEqual(rootKeepTopN);
            expect(outBytes).toBeGreaterThan(targetBytes);
        });
    });
});

// ─── aggressivelySimplify on schemas built with the new generator knobs ────
//
// The previous block (`maxNestingDepth` / `polymorphismRate` directly above
// this comment used to live here) tested the *generator* in isolation — but
// what we really care about is how those new data shapes interact with the
// production simplifier.  These tests pin the contract end-to-end:
//
//   generator(knob) → analyzer → aggressivelySimplify → snapshot
//
// Each variant also asserts a **precondition on the raw schema** so that a
// regression in the generator can't silently degrade the test into a flat /
// non-polymorphic baseline.
describe('aggressivelySimplify on generated schemas with new generator knobs', () => {
    /**
     * Max depth at which any node in the schema still has its own `properties`
     * bag.  Matches the convention used by `computeMaxDepth` in
     * `SchemaService.ts`: root = 0, root entry = 1, root entry's object value = 2.
     */
    function maxObjectDepth(node: JSONSchema, depth = 0): number {
        if (!node || typeof node !== 'object') return depth - 1;
        let max = depth;
        if (node.properties) {
            for (const child of Object.values(node.properties)) {
                if (child && typeof child === 'object') {
                    const d = maxObjectDepth(child, depth + 1);
                    if (d > max) max = d;
                }
            }
        }
        // `anyOf` alternatives sit at the same depth as their parent — they
        // describe alternative types of one field, not a deeper nesting.
        if (node.anyOf) {
            for (const entry of node.anyOf) {
                if (entry && typeof entry === 'object') {
                    const d = maxObjectDepth(entry, depth);
                    if (d > max) max = d;
                }
            }
        }
        return max;
    }

    /**
     * Number of schema entries that survived as polymorphic — i.e. whose
     * `anyOf` lists more than one type variant.  `simplifySchema` (called by
     * the analyzer) unwraps the trivial single-type case, so any node still
     * holding an `anyOf` truly represents drifted types across documents.
     */
    function countPolymorphicEntries(node: JSONSchema): number {
        if (!node || typeof node !== 'object') return 0;
        let count = 0;
        if (Array.isArray(node.anyOf) && node.anyOf.length > 1) {
            count += 1;
        }
        if (node.properties) {
            for (const child of Object.values(node.properties)) {
                if (child && typeof child === 'object') {
                    count += countPolymorphicEntries(child);
                }
            }
        }
        if (node.anyOf) {
            for (const entry of node.anyOf) {
                if (entry && typeof entry === 'object') {
                    count += countPolymorphicEntries(entry);
                }
            }
        }
        return count;
    }

    /**
     * Dumps the pre-simplification schema next to its snapshot so a human
     * can eyeball "before" and "after" during review.  Lives under
     * `__mocks__/raw/`, which is gitignored — same convention as the
     * preset snapshot tests above.  Failures here are non-fatal: it's
     * purely a developer convenience.
     */
    function persistRawFixture(rawSchema: unknown, variantName: string): void {
        try {
            const rawDir = path.resolve(__dirname, '__mocks__/raw');
            fs.mkdirSync(rawDir, { recursive: true });
            fs.writeFileSync(
                path.resolve(rawDir, `raw-${variantName}.json`),
                JSON.stringify(rawSchema, null, 2),
                'utf8',
            );
        } catch {
            // Non-fatal — dev convenience only.
        }
    }

    it('deep variant (maxNestingDepth=4): simplifier still respects the byte budget', async () => {
        const { documents } = generateLargeSchemaDocuments({
            targetMB: 5,
            recordCount: 50,
            seed: 42,
            maxNestingDepth: 4,
        });
        const rawSchema = getSchemaFromDocuments(documents);

        // Precondition: the raw schema really IS 4 levels deep.  Without
        // this the budget assertion below could pass trivially on a flat
        // input if the generator silently regressed.
        expect(maxObjectDepth(rawSchema)).toBe(4);

        persistRawFixture(rawSchema, 'deep');

        const rawBytes = Buffer.byteLength(JSON.stringify(rawSchema), 'utf8');
        const { schema: simplified, wasSimplified } = aggressivelySimplify(rawSchema, {
            targetSizeBytes: DEFAULT_SIMPLIFIED_TARGET_BYTES,
            maxDepth: 3,
            keepTopN: 2,
            rootKeepTopN: 50,
            popularityKey: 'x-occurrence',
        });
        const simplifiedBytes = Buffer.byteLength(JSON.stringify(simplified), 'utf8');

        expect(wasSimplified).toBe(true);
        expect(simplifiedBytes).toBeLessThanOrEqual(DEFAULT_SIMPLIFIED_TARGET_BYTES);
        expect(simplifiedBytes).toBeLessThan(rawBytes);

        const fixturePath = path.resolve(__dirname, '__mocks__/simplified-deep.json');
        await expect(JSON.stringify(simplified, null, 2) + '\n').toMatchFileSnapshot(fixturePath);
    });

    it('polymorphic variant (polymorphismRate=0.5): simplifier keeps `anyOf` alternatives within the budget', async () => {
        const { documents } = generateLargeSchemaDocuments({
            targetMB: 5,
            recordCount: 50,
            seed: 42,
            polymorphismRate: 0.5,
        });
        const rawSchema = getSchemaFromDocuments(documents);

        // Precondition: the raw schema genuinely has polymorphic entries —
        // otherwise the "anyOf survives" assertion below would pass
        // trivially on a non-polymorphic baseline.
        expect(countPolymorphicEntries(rawSchema)).toBeGreaterThanOrEqual(5);

        persistRawFixture(rawSchema, 'polymorphic');

        const rawBytes = Buffer.byteLength(JSON.stringify(rawSchema), 'utf8');
        const { schema: simplified, wasSimplified } = aggressivelySimplify(rawSchema, {
            targetSizeBytes: DEFAULT_SIMPLIFIED_TARGET_BYTES,
            maxDepth: 3,
            keepTopN: 2,
            rootKeepTopN: 50,
            popularityKey: 'x-occurrence',
        });
        const simplifiedBytes = Buffer.byteLength(JSON.stringify(simplified), 'utf8');

        expect(wasSimplified).toBe(true);
        expect(simplifiedBytes).toBeLessThanOrEqual(DEFAULT_SIMPLIFIED_TARGET_BYTES);
        expect(simplifiedBytes).toBeLessThan(rawBytes);
        // Simplifier strips `x-*` stats but MUST leave `anyOf` alternatives
        // intact — they carry the real type information the AI needs in
        // order to suggest correct queries against polymorphic fields.
        expect(countPolymorphicEntries(simplified)).toBeGreaterThanOrEqual(1);

        const fixturePath = path.resolve(__dirname, '__mocks__/simplified-polymorphic.json');
        await expect(JSON.stringify(simplified, null, 2) + '\n').toMatchFileSnapshot(fixturePath);
    });
});

// ─── composeMetadata — frozen-count semantics ──────────────────────────────
//
// Regression coverage for the bug where an incremental write arriving with
// `updateFromQueriesEnabled === false` *after* the count had already been
// frozen by a query-driven write would silently unfreeze and re-add the new
// documents to the frozen sample size.

describe('composeMetadata — frozen-count semantics', () => {
    const baseArgs = {
        schemaId: 'sid',
        containerLabel: 'db/c',
        connection,
        wasSimplifiedOnSave: false,
    };

    it('fresh generation resets everything regardless of previous state', () => {
        const previous: SchemaMetadata = {
            id: 'sid',
            name: 'db/c',
            generatedAt: '2025-01-01T00:00:00.000Z',
            documentCount: '500',
            initialDocumentCount: '500',
            updatedFromQueries: true,
        };

        const meta = composeMetadata({
            ...baseArgs,
            sampleSize: 1000,
            isFreshGeneration: true,
            previousMetadata: previous,
            updateFromQueriesEnabled: false,
        });

        expect(meta.documentCount).toBe('1000');
        expect(meta.initialDocumentCount).toBe('1000');
        expect(meta.updatedFromQueries).toBe(false);
    });

    it('query-driven incremental write freezes the count at previousDocCount', () => {
        const previous: SchemaMetadata = {
            id: 'sid',
            name: 'db/c',
            generatedAt: '2025-01-01T00:00:00.000Z',
            documentCount: '500',
            initialDocumentCount: '500',
            updatedFromQueries: false,
        };

        const meta = composeMetadata({
            ...baseArgs,
            sampleSize: 510, // 500 previous + 10 new
            isFreshGeneration: false,
            previousMetadata: previous,
            updateFromQueriesEnabled: true,
        });

        expect(meta.documentCount).toBe('500');
        expect(meta.initialDocumentCount).toBe('500');
        expect(meta.updatedFromQueries).toBe(true);
    });

    it('non-query write while the count is still trustworthy keeps running it', () => {
        const previous: SchemaMetadata = {
            id: 'sid',
            name: 'db/c',
            generatedAt: '2025-01-01T00:00:00.000Z',
            documentCount: '500',
            initialDocumentCount: '500',
            updatedFromQueries: false,
        };

        const meta = composeMetadata({
            ...baseArgs,
            sampleSize: 510,
            isFreshGeneration: false,
            previousMetadata: previous,
            updateFromQueriesEnabled: false,
        });

        expect(meta.documentCount).toBe('510');
        expect(meta.initialDocumentCount).toBe('500');
        expect(meta.updatedFromQueries).toBe(false);
    });

    // Regression: previously this fell through to the non-query branch and
    // produced documentCount = '510' with updatedFromQueries = true — a
    // mix-and-match of frozen and post-freeze counts that mismatched the
    // intent of the frozen state.
    it('non-query write after the count has been frozen keeps it frozen (regression)', () => {
        const previous: SchemaMetadata = {
            id: 'sid',
            name: 'db/c',
            generatedAt: '2025-01-01T00:00:00.000Z',
            documentCount: '500',
            initialDocumentCount: '500',
            updatedFromQueries: true,
        };

        const meta = composeMetadata({
            ...baseArgs,
            sampleSize: 510,
            isFreshGeneration: false,
            previousMetadata: previous,
            updateFromQueriesEnabled: false,
        });

        expect(meta.documentCount).toBe('500');
        expect(meta.initialDocumentCount).toBe('500');
        expect(meta.updatedFromQueries).toBe(true);
    });

    it('query-driven write after the count is already frozen is idempotent', () => {
        const previous: SchemaMetadata = {
            id: 'sid',
            name: 'db/c',
            generatedAt: '2025-01-01T00:00:00.000Z',
            documentCount: '500',
            initialDocumentCount: '500',
            updatedFromQueries: true,
        };

        const meta = composeMetadata({
            ...baseArgs,
            sampleSize: 510,
            isFreshGeneration: false,
            previousMetadata: previous,
            updateFromQueriesEnabled: true,
        });

        expect(meta.documentCount).toBe('500');
        expect(meta.updatedFromQueries).toBe(true);
    });
});

// ─── persistWithSizeGuard — over-limit messaging ───────────────────────────
//
// Regression coverage for the bug where a schema that came back from
// `aggressivelySimplify` still over `SCHEMA_SIZE_LIMIT_BYTES` was persisted
// with the cheerful "automatically simplified" notification, masking the
// fact that the budget was missed.
//
// The clean-case integration test below exercises the happy path
// end-to-end (over-limit raw input → simplifier brings it under the limit
// → cheerful message).  The honesty-of-wording branch ("still over limit"
// after simplification) is unreachable through any realistic data shape at
// the production `rootKeepTopN = 50` / `SCHEMA_SIZE_LIMIT_BYTES = 5 MB`
// combination, so it is left as a defensive code path rather than tested
// through synthetic data.  Manual eyeball review of the persist function is
// the safety net for that one.

describe('SchemaService.mergeDocumentsIntoSchema — over-limit messaging', () => {
    /** Build a wide raw schema that definitely trips the 5 MB size guard. */
    function buildOversizedDocuments(): Record<string, unknown>[] {
        const { documents } = generateLargeSchemaDocuments({ ...LARGE_SCHEMA_PRESETS.medium });
        return documents;
    }

    it(
        'shows the "automatically simplified" notification and saves a payload under the limit',
        { timeout: 60_000 },
        async () => {
            const service = new SchemaService();
            const showInfo = vi
                .spyOn(vscode.window, 'showInformationMessage')
                .mockResolvedValue(undefined as unknown as vscode.MessageItem);
            showInfo.mockClear();

            await service.mergeDocumentsIntoSchema(connection, buildOversizedDocuments(), {
                source: 'manualGenerate',
                suppressNotification: false,
            });

            expect(showInfo).toHaveBeenCalledTimes(1);
            const messageShown = String(showInfo.mock.calls[0][0]);
            expect(messageShown.includes('automatically simplified before saving')).toBe(true);
            // Honesty: the message implies "fits under the limit now" — verify it.
            const savedJson = fakeStorage.saveSchema.mock.calls.at(-1)?.[1];
            expect(savedJson).toBeDefined();
            const savedBytes = Buffer.byteLength(savedJson!, 'utf8');
            expect(savedBytes).toBeLessThanOrEqual(SCHEMA_SIZE_LIMIT_BYTES);

            // outputChannel.warn must record the pre-simplification size — it's
            // the only durable diagnostic when a user later complains the schema
            // looks pruned.
            const warnMessages = outputChannel.warn.mock.calls.map((c) => String(c[0]));
            expect(warnMessages.some((m) => m.includes('auto-simplifying before save'))).toBe(true);
        },
    );

    it(
        'honours suppressNotification — no popup is shown even when simplification kicks in',
        { timeout: 60_000 },
        async () => {
            const service = new SchemaService();
            const showInfo = vi
                .spyOn(vscode.window, 'showInformationMessage')
                .mockResolvedValue(undefined as unknown as vscode.MessageItem);
            showInfo.mockClear();

            await service.mergeDocumentsIntoSchema(connection, buildOversizedDocuments(), {
                source: 'manualGenerate',
                suppressNotification: true,
            });

            expect(showInfo).not.toHaveBeenCalled();
            // The warn log still fires unconditionally so the diagnostic trace
            // is preserved even when notifications are suppressed.
            const warnMessages = outputChannel.warn.mock.calls.map((c) => String(c[0]));
            expect(warnMessages.some((m) => m.includes('auto-simplifying before save'))).toBe(true);
        },
    );
});
