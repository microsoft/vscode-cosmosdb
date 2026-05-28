/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { type SchemaMetadata } from './SchemaFileStorage';

// Minimal in-memory globalState fake used by both `ext` and the migrate-from
// fixture below. Reset between tests so suites stay independent.
class InMemoryGlobalState {
    private readonly entries = new Map<string, unknown>();

    keys(): readonly string[] {
        return Array.from(this.entries.keys());
    }
    get<T>(key: string): T | undefined {
        return this.entries.get(key) as T | undefined;
    }
    update(key: string, value: unknown): Thenable<void> {
        if (value === undefined) {
            this.entries.delete(key);
        } else {
            this.entries.set(key, value);
        }
        return Promise.resolve();
    }
    clear(): void {
        this.entries.clear();
    }
}

const fakeGlobalState = new InMemoryGlobalState();
const fakeStorageUri = vscode.Uri.file('C:/tmp/schema-storage-test');

vi.mock('../extensionVariables', () => ({
    ext: {
        context: {
            globalStorageUri: fakeStorageUri,
            globalState: fakeGlobalState,
        },
        outputChannel: {
            appendLog: vi.fn(),
            warn: vi.fn(),
            info: vi.fn(),
        },
    },
}));

// Backing store for the mocked filesystem. Keys are URI fsPath strings.
const fileSystem = new Map<string, Uint8Array>();

beforeEach(() => {
    fakeGlobalState.clear();
    fileSystem.clear();

    vi.spyOn(vscode.workspace.fs, 'createDirectory').mockResolvedValue(undefined);
    vi.spyOn(vscode.workspace.fs, 'writeFile').mockImplementation(async (uri, content) => {
        fileSystem.set(uri.fsPath, content);
    });
    vi.spyOn(vscode.workspace.fs, 'readFile').mockImplementation(async (uri) => {
        const data = fileSystem.get(uri.fsPath);
        if (!data) {
            throw new Error(`ENOENT: ${uri.fsPath}`);
        }
        return data;
    });
    vi.spyOn(vscode.workspace.fs, 'delete').mockImplementation(async (uri) => {
        if (!fileSystem.delete(uri.fsPath)) {
            throw new Error(`ENOENT: ${uri.fsPath}`);
        }
    });
});

afterEach(() => {
    vi.restoreAllMocks();
});

// Imported after mocks so the module wires up against the fake ext.
const { SchemaFileStorage } = await import('./SchemaFileStorage');

function makeMetadata(overrides: Partial<SchemaMetadata> = {}): SchemaMetadata {
    return {
        id: 'schema-1',
        name: 'db/container',
        generatedAt: '2025-01-01T00:00:00.000Z',
        documentCount: '42',
        endpoint: 'https://example.documents.azure.com:443/',
        databaseId: 'db',
        containerId: 'container',
        ...overrides,
    };
}

describe('SchemaFileStorage', () => {
    describe('getSchemaIdForConnection', () => {
        it('returns a deterministic hash for the same connection', () => {
            const a = SchemaFileStorage.getSchemaIdForConnection({
                endpoint: 'https://example.documents.azure.com:443/',
                databaseId: 'db',
                containerId: 'container',
            });
            const b = SchemaFileStorage.getSchemaIdForConnection({
                endpoint: 'https://example.documents.azure.com:443/',
                databaseId: 'db',
                containerId: 'container',
            });
            expect(a).toBe(b);
            expect(a).toMatch(/^[a-f0-9]{64}$/);
        });

        it('produces different hashes for different containers', () => {
            const a = SchemaFileStorage.getSchemaIdForConnection({
                endpoint: 'https://example.documents.azure.com:443/',
                databaseId: 'db',
                containerId: 'container',
            });
            const b = SchemaFileStorage.getSchemaIdForConnection({
                endpoint: 'https://example.documents.azure.com:443/',
                databaseId: 'db',
                containerId: 'container-2',
            });
            expect(a).not.toBe(b);
        });
    });

    describe('saveSchema + readSchema', () => {
        it('round-trips a schema and its metadata', async () => {
            const storage = SchemaFileStorage.getInstance();
            const metadata = makeMetadata();
            const schemaJson = JSON.stringify({ type: 'object', properties: { name: { type: 'string' } } });

            await storage.saveSchema(metadata, schemaJson);

            expect(storage.hasSchema(metadata.id)).toBe(true);
            expect(storage.getMetadata(metadata.id)).toEqual(metadata);

            const read = await storage.readSchema(metadata.id);
            expect(read).toBeDefined();
            // Pretty-printed on disk — compare semantically.
            expect(JSON.parse(read!)).toEqual(JSON.parse(schemaJson));
        });

        it('strips undefined fields from persisted metadata', async () => {
            const storage = SchemaFileStorage.getInstance();
            const metadata = makeMetadata({
                initialDocumentCount: undefined,
                wasSimplifiedOnSave: undefined,
            });

            await storage.saveSchema(metadata, '{}');
            const stored = storage.getMetadata(metadata.id)!;

            expect(Object.prototype.hasOwnProperty.call(stored, 'initialDocumentCount')).toBe(false);
            expect(Object.prototype.hasOwnProperty.call(stored, 'wasSimplifiedOnSave')).toBe(false);
        });

        it('writes pretty-printed JSON to disk', async () => {
            const storage = SchemaFileStorage.getInstance();
            await storage.saveSchema(makeMetadata(), '{"type":"object"}');

            const fileUri = storage.getSchemaFileUri('schema-1');
            const onDisk = Buffer.from(fileSystem.get(fileUri.fsPath)!).toString('utf8');

            expect(onDisk).toContain('\n');
            expect(JSON.parse(onDisk)).toEqual({ type: 'object' });
        });
    });

    describe('readSchema / hasSchema for missing data', () => {
        it('readSchema returns undefined when the file is missing', async () => {
            const storage = SchemaFileStorage.getInstance();
            await expect(storage.readSchema('does-not-exist')).resolves.toBeUndefined();
        });

        it('hasSchema returns false when no metadata is stored', () => {
            const storage = SchemaFileStorage.getInstance();
            expect(storage.hasSchema('does-not-exist')).toBe(false);
        });
    });

    describe('getAllSchemaIds / getAllMetadata', () => {
        it('only returns entries under the schema metadata prefix', async () => {
            const storage = SchemaFileStorage.getInstance();
            await storage.saveSchema(makeMetadata({ id: 'a' }), '{}');
            await storage.saveSchema(makeMetadata({ id: 'b', name: 'db/other' }), '{}');
            await fakeGlobalState.update('unrelated-key', 'should-not-show');

            const ids = storage.getAllSchemaIds().sort();
            expect(ids).toEqual(['a', 'b']);

            const all = storage.getAllMetadata();
            expect(all).toHaveLength(2);
            expect(all.map((m) => m.id).sort()).toEqual(['a', 'b']);
        });
    });

    describe('findSchemasForContainer', () => {
        it('matches schemas by endpoint/database/container', async () => {
            const storage = SchemaFileStorage.getInstance();
            await storage.saveSchema(makeMetadata({ id: 'match' }), '{}');
            await storage.saveSchema(makeMetadata({ id: 'other-container', containerId: 'c2' }), '{}');
            await storage.saveSchema(makeMetadata({ id: 'other-db', databaseId: 'db2' }), '{}');

            const matches = storage.findSchemasForContainer(
                'https://example.documents.azure.com:443/',
                'db',
                'container',
            );
            expect(matches).toHaveLength(1);
            expect(matches[0].id).toBe('match');
        });

        it('falls back to the hashed schemaId when metadata predates endpoint/database fields', async () => {
            const storage = SchemaFileStorage.getInstance();
            const legacyId = SchemaFileStorage.getSchemaIdForConnection({
                endpoint: 'https://example.documents.azure.com:443/',
                databaseId: 'db',
                containerId: 'container',
            });
            // Legacy metadata: no endpoint/database/container fields.
            await storage.saveSchema(
                {
                    id: legacyId,
                    name: 'db/container',
                    generatedAt: '2024-01-01T00:00:00.000Z',
                    documentCount: '10',
                },
                '{}',
            );

            const matches = storage.findSchemasForContainer(
                'https://example.documents.azure.com:443/',
                'db',
                'container',
            );
            expect(matches).toHaveLength(1);
            expect(matches[0].id).toBe(legacyId);
        });
    });

    describe('findSchemasForDatabase', () => {
        it('returns every schema that shares the endpoint/database pair', async () => {
            const storage = SchemaFileStorage.getInstance();
            await storage.saveSchema(makeMetadata({ id: 'c1', containerId: 'c1' }), '{}');
            await storage.saveSchema(makeMetadata({ id: 'c2', containerId: 'c2' }), '{}');
            await storage.saveSchema(makeMetadata({ id: 'other', databaseId: 'db2' }), '{}');

            const matches = storage.findSchemasForDatabase('https://example.documents.azure.com:443/', 'db');
            expect(matches.map((m) => m.id).sort()).toEqual(['c1', 'c2']);
        });
    });

    describe('deleteSchema', () => {
        it('removes the file and the metadata entry', async () => {
            const storage = SchemaFileStorage.getInstance();
            await storage.saveSchema(makeMetadata(), '{}');
            const fileUri = storage.getSchemaFileUri('schema-1');
            expect(fileSystem.has(fileUri.fsPath)).toBe(true);

            await storage.deleteSchema('schema-1');

            expect(storage.hasSchema('schema-1')).toBe(false);
            expect(fileSystem.has(fileUri.fsPath)).toBe(false);
        });

        it('ignores missing files', async () => {
            const storage = SchemaFileStorage.getInstance();
            await expect(storage.deleteSchema('does-not-exist')).resolves.toBeUndefined();
        });
    });

    describe('deleteAllSchemas', () => {
        it('clears every stored schema', async () => {
            const storage = SchemaFileStorage.getInstance();
            await storage.saveSchema(makeMetadata({ id: 'a' }), '{}');
            await storage.saveSchema(makeMetadata({ id: 'b' }), '{}');

            await storage.deleteAllSchemas();

            expect(storage.getAllSchemaIds()).toEqual([]);
            expect(fileSystem.size).toBe(0);
        });
    });

    describe('migrateFromGlobalState', () => {
        const oldKey = 'schemas';
        const oldPrefix = `ms-azuretools.vscode-cosmosdb.default/${oldKey}/`;

        it('moves old globalState entries to file-based storage and removes the originals', async () => {
            const storage = SchemaFileStorage.getInstance();
            await fakeGlobalState.update(`${oldPrefix}legacy-id`, {
                id: 'legacy-id',
                name: 'db/legacy',
                properties: {
                    schema: '{"type":"object"}',
                    generatedAt: '2024-01-01T00:00:00.000Z',
                    documentCount: '7',
                },
            });

            await storage.migrateFromGlobalState(oldKey);

            expect(storage.hasSchema('legacy-id')).toBe(true);
            expect(fakeGlobalState.get(`${oldPrefix}legacy-id`)).toBeUndefined();

            const migrated = storage.getMetadata('legacy-id')!;
            expect(migrated.name).toBe('db/legacy');
            expect(migrated.documentCount).toBe('7');
        });

        it('is idempotent — already-migrated entries are not overwritten', async () => {
            const storage = SchemaFileStorage.getInstance();
            await storage.saveSchema(
                makeMetadata({ id: 'legacy-id', documentCount: '999', generatedAt: '2025-06-01T00:00:00.000Z' }),
                '{"type":"object"}',
            );
            await fakeGlobalState.update(`${oldPrefix}legacy-id`, {
                id: 'legacy-id',
                name: 'db/legacy',
                properties: {
                    schema: '{"type":"object"}',
                    generatedAt: '2024-01-01T00:00:00.000Z',
                    documentCount: '7',
                },
            });

            await storage.migrateFromGlobalState(oldKey);

            const after = storage.getMetadata('legacy-id')!;
            // Existing entry preserved, old removed.
            expect(after.documentCount).toBe('999');
            expect(fakeGlobalState.get(`${oldPrefix}legacy-id`)).toBeUndefined();
        });

        it('skips invalid legacy entries but still cleans them up', async () => {
            const storage = SchemaFileStorage.getInstance();
            await fakeGlobalState.update(`${oldPrefix}broken-id`, { id: 'broken-id', name: 'x' });

            await storage.migrateFromGlobalState(oldKey);

            expect(storage.hasSchema('broken-id')).toBe(false);
            expect(fakeGlobalState.get(`${oldPrefix}broken-id`)).toBeUndefined();
        });
    });
});
