/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { ModelingAdvisorProjectSchema, type ModelingAdvisorSnapshot } from '../dataModeling/modelingAdvisorSchema';
import { createBlankContainer, createInitialState } from '../webviews/cosmosdb/DataModeling/dataModel';
import { DATA_MODELER_RETENTION_MS, DataModelerProjectService } from './DataModelerProjectService';

vi.mock('../extensionVariables', () => ({
    ext: {
        context: {
            get globalStorageUri() {
                return storageUri;
            },
        },
        outputChannel: { warn: vi.fn() },
    },
}));

const files = new Map<string, Uint8Array>();
const modifiedTimes = new Map<string, number>();
const storageUri = vscode.Uri.file('C:\\global-storage\\modeler-test');
const endpoint = 'https://account-a.documents.azure.com/';
let service: DataModelerProjectService;

function snapshot(): ModelingAdvisorSnapshot {
    const container = createBlankContainer('Messages');
    container.scale.candidates[0].distinctValues = 12345;
    return {
        wizard: {
            ...createInitialState(),
            step: 4,
            scenario: 'chat',
            dataModel: { containers: [container], activeContainerId: container.id },
        },
        recommendation: {
            status: 'received',
            value: {
                summary: 'Use conversationId.',
                containers: [
                    {
                        entity: 'Messages',
                        partitionKey: '/conversationId',
                        rationale: 'Messages are read per conversation.',
                        candidates: [
                            {
                                partitionKey: '/conversationId',
                                verdict: 'recommended',
                                score: 90,
                                assessments: [
                                    { label: 'Query match', status: 'pass', detail: 'Targets a conversation.' },
                                ],
                            },
                        ],
                        hotPartitionRisk: [{ partitionKey: '/conversationId', risk: 'low', pct: 5 }],
                        documentIdStrategy: { tag: 'Message ID', recommendation: 'Use a unique message ID.' },
                        guardrails: [{ rule: 'Immutability', detail: 'The supplied conversationId never changes.' }],
                        queryRouting: { headline: 'Targeted reads', routes: [], analysis: 'Single partition reads.' },
                    },
                ],
            },
        },
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    files.clear();
    modifiedTimes.clear();
    service = new DataModelerProjectService(endpoint);
    vi.spyOn(vscode.workspace.fs, 'createDirectory').mockResolvedValue(undefined);
    vi.spyOn(vscode.workspace.fs, 'stat').mockImplementation(async (uri) => {
        const contents = files.get(uri.toString());
        if (!contents) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
        return {
            type: vscode.FileType.File,
            mtime: modifiedTimes.get(uri.toString()) ?? Date.now(),
            ctime: 0,
            size: contents.byteLength,
        };
    });
    vi.spyOn(vscode.workspace.fs, 'readDirectory').mockImplementation(async (uri) => {
        const prefix = uri.toString() + '/';
        const entries: [string, vscode.FileType][] = [];
        for (const key of files.keys()) {
            if (key.startsWith(prefix) && !key.slice(prefix.length).includes('/')) {
                entries.push([key.slice(prefix.length), vscode.FileType.File]);
            }
        }
        return entries;
    });
    vi.spyOn(vscode.workspace.fs, 'readFile').mockImplementation(async (uri) => {
        const contents = files.get(uri.toString());
        if (!contents) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
        return contents;
    });
    vi.spyOn(vscode.workspace.fs, 'writeFile').mockImplementation(async (uri, contents) => {
        files.set(uri.toString(), contents);
        modifiedTimes.set(uri.toString(), Date.now());
    });
    vi.spyOn(vscode.workspace.fs, 'rename').mockImplementation(async (from, to) => {
        const contents = files.get(from.toString());
        if (!contents) {
            throw vscode.FileSystemError.FileNotFound(from);
        }
        files.set(to.toString(), contents);
        modifiedTimes.set(to.toString(), modifiedTimes.get(from.toString()) ?? Date.now());
        files.delete(from.toString());
        modifiedTimes.delete(from.toString());
    });
    vi.spyOn(vscode.workspace.fs, 'delete').mockImplementation(async (uri) => {
        if (!files.delete(uri.toString())) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
        modifiedTimes.delete(uri.toString());
    });
});

afterEach(() => vi.restoreAllMocks());

describe('DataModelerProjectService', () => {
    it('uses global storage and does not create a project merely by opening with no saved state', async () => {
        expect(await service.loadState()).toBeNull();
        expect(vscode.workspace.fs.writeFile).not.toHaveBeenCalled();
        expect(service.folderUri.toString()).toBe(vscode.Uri.joinPath(storageUri, 'data-modeler').toString());
        expect(service.projectUri.path).toMatch(/\/data-modeler\/[a-f0-9]{64}\.json$/);
        expect(service.projectUri.path).not.toContain('account-a');
    });

    it('round-trips model inputs, navigation and recommendations in the version-1 envelope', async () => {
        await service.loadState();
        const state = snapshot();
        await service.saveState(state);

        const saved = files.get(service.projectUri.toString());
        expect(saved).toBeDefined();
        const json = JSON.parse(Buffer.from(saved!).toString('utf8')) as unknown;
        expect(ModelingAdvisorProjectSchema.parse(json)).toEqual({ version: 1, name: 'Data Modeler', state });
        expect(await new DataModelerProjectService(endpoint).loadState()).toEqual(state);
        expect(files.size).toBe(1);
        expect(vscode.workspace.fs.rename).toHaveBeenCalledWith(expect.anything(), service.projectUri, {
            overwrite: true,
        });
    });

    it.each([
        ['malformed JSON', '{broken'],
        ['unsupported version', JSON.stringify({ version: 2, name: 'Newer', state: snapshot() })],
        ['invalid state', JSON.stringify({ version: 1, name: 'Invalid', state: {} })],
    ])('preserves a project with %s and blocks saves until a successful load', async (_, text) => {
        files.set(service.projectUri.toString(), Buffer.from(text));
        await expect(service.loadState()).rejects.toThrow(/valid JSON|invalid format|unsupported version/);
        await expect(service.saveState(snapshot())).rejects.toThrow('Load the saved data model');
        expect(Buffer.from(files.get(service.projectUri.toString())!).toString()).toBe(text);
        expect(vscode.workspace.fs.writeFile).not.toHaveBeenCalled();
    });

    it('does not treat permission errors as an empty project', async () => {
        files.set(service.projectUri.toString(), Buffer.from('{}'));
        vi.mocked(vscode.workspace.fs.readFile).mockRejectedValueOnce(vscode.FileSystemError.NoPermissions());
        await expect(service.loadState()).rejects.toThrow(vscode.FileSystemError);
        await expect(service.saveState(snapshot())).rejects.toThrow('Load the saved data model');
    });

    it('protects files externally changed to an unsupported version after loading', async () => {
        await service.loadState();
        files.set(service.projectUri.toString(), Buffer.from('{"version":99}'));
        await expect(service.saveState(snapshot())).rejects.toThrow('unsupported version');
        expect(vscode.workspace.fs.writeFile).not.toHaveBeenCalled();
    });

    it('serializes rapid autosaves so the latest state wins', async () => {
        await service.loadState();
        const first = snapshot();
        const last = { ...first, wizard: { ...first.wizard, step: 2 } };
        await Promise.all([service.saveState(first), service.saveState(last)]);
        expect(await service.loadState()).toEqual(last);
    });

    it('retains the previous project when replacement fails and allows retry', async () => {
        await service.loadState();
        const first = snapshot();
        await service.saveState(first);
        const last = { ...first, wizard: { ...first.wizard, step: 2 } };
        vi.mocked(vscode.workspace.fs.rename).mockRejectedValueOnce(vscode.FileSystemError.NoPermissions());
        await expect(service.saveState(last)).rejects.toThrow(vscode.FileSystemError);
        expect(await service.loadState()).toEqual(first);
        expect(files.size).toBe(1);
        await service.saveState(last);
        expect(await service.loadState()).toEqual(last);
    });

    it('restores interrupted requests as retryable errors, not permanent loading states', async () => {
        await service.loadState();
        const state = snapshot();
        state.recommendation = { status: 'waiting' };
        await service.saveState(state);
        const restored = await new DataModelerProjectService(endpoint).loadState();
        expect(restored?.wizard).toEqual(state.wizard);
        expect(restored?.recommendation).toMatchObject({
            status: 'error',
            error: expect.stringContaining('interrupted'),
        });
    });

    it('persists restart without restoring an old recommendation', async () => {
        await service.loadState();
        const state = snapshot();
        await service.saveState(state);
        state.recommendation = { status: 'idle' };
        await service.saveState(state);
        expect((await new DataModelerProjectService(endpoint).loadState())?.recommendation).toEqual({
            status: 'idle',
        });
    });

    it('reads older snapshots but drops temporary view state on subsequent saves', async () => {
        const state = snapshot();
        files.set(
            service.projectUri.toString(),
            Buffer.from(
                JSON.stringify({
                    version: 1,
                    name: 'Data Modeler',
                    state: { ...state, view: { draftTag: 'old draft' } },
                }),
            ),
        );
        expect(await service.loadState()).toEqual(state);
        await service.saveState(state);
        const json = JSON.parse(Buffer.from(files.get(service.projectUri.toString())!).toString()) as unknown;
        expect(json).toEqual({ version: 1, name: 'Data Modeler', state });
    });

    it('shares a queue for the same canonical endpoint, independent of label or credentials', () => {
        expect(DataModelerProjectService.getInstance(endpoint)).toBe(
            DataModelerProjectService.getInstance('HTTPS://ACCOUNT-A.documents.azure.com:443'),
        );
        expect(DataModelerProjectService.getInstance(endpoint)).not.toBe(
            DataModelerProjectService.getInstance('https://account-b.documents.azure.com/'),
        );
    });

    it('saves and restores without a workspace, without modifying old workspace-local projects', async () => {
        const originalFolders = vscode.workspace.workspaceFolders;
        Object.defineProperty(vscode.workspace, 'workspaceFolders', { value: undefined, configurable: true });
        const oldProjectUri = vscode.Uri.file('C:\\old-workspace\\.cosmos\\data-modeler.json');
        const oldContents = Buffer.from('existing workspace project');
        files.set(oldProjectUri.toString(), oldContents);
        try {
            const state = snapshot();
            await service.loadState();
            await service.saveState(state);
            expect(await new DataModelerProjectService(endpoint).loadState()).toEqual(state);
            expect(files.get(oldProjectUri.toString())).toBe(oldContents);
            expect(files.size).toBe(2);
        } finally {
            Object.defineProperty(vscode.workspace, 'workspaceFolders', {
                value: originalFolders,
                configurable: true,
            });
        }
    });

    it('rejects received recommendations without a result', async () => {
        await service.loadState();
        const state = snapshot();
        state.recommendation = { status: 'received' };
        await expect(service.saveState(state)).rejects.toThrow('invalid');
    });

    it('isolates inputs, recommendations, and Start Over between accounts with concurrent saves', async () => {
        const second = new DataModelerProjectService('https://account-b.documents.azure.com');
        const firstState = snapshot();
        const secondState = snapshot();
        secondState.wizard.dataModel.containers[0].scale.candidates[0].distinctValues = 67890;
        secondState.recommendation.value!.summary = 'Account B recommendation';
        await service.loadState();
        await service.saveState(firstState);
        expect(await second.loadState()).toBeNull();
        await Promise.all([service.saveState(firstState), second.saveState(secondState)]);
        expect(await service.loadState()).toEqual(firstState);
        expect(await second.loadState()).toEqual(secondState);
        await service.saveState({ wizard: createInitialState(), recommendation: { status: 'idle' } });
        expect(await second.loadState()).toEqual(secondState);
        expect(files.size).toBe(2);
    });

    it('leaves the old unscoped global session untouched rather than attributing it to an account', async () => {
        const legacy = vscode.Uri.joinPath(storageUri, 'data-modeler.json');
        const content = Buffer.from(JSON.stringify({ version: 1, name: 'Old', state: snapshot() }));
        files.set(legacy.toString(), content);
        expect(await service.loadState()).toBeNull();
        await service.saveState(snapshot());
        expect(files.get(legacy.toString())).toBe(content);
    });

    it('loads older priority-based projects without recalculating their saved recommendations', async () => {
        const state = snapshot();
        const candidate = state.recommendation.value!.containers[0].candidates![0];
        const legacy = {
            version: 1,
            name: 'Saved model',
            state: {
                wizard: { ...state.wizard, weights: { read: 80, write: 10, storage: 10 } },
                recommendation: {
                    ...state.recommendation,
                    weights: { read: 80, write: 10, storage: 10 },
                    value: {
                        ...state.recommendation.value,
                        containers: [
                            {
                                ...state.recommendation.value!.containers[0],
                                candidates: [
                                    {
                                        ...candidate,
                                        priorityScores: { read: 100, write: 20, storage: 50 },
                                        rationale: 'Previously weighted recommendation.',
                                    },
                                ],
                            },
                        ],
                    },
                },
            },
        };
        files.set(service.projectUri.toString(), Buffer.from(JSON.stringify(legacy)));
        expect(await service.loadState()).toEqual(state);
    });

    it('does not let a corrupt account file block another account', async () => {
        const second = new DataModelerProjectService('https://account-b.documents.azure.com');
        files.set(service.projectUri.toString(), Buffer.from('invalid'));
        await expect(service.loadState()).rejects.toThrow('not valid JSON');
        expect(await second.loadState()).toBeNull();
        const state = snapshot();
        await second.saveState(state);
        expect(await second.loadState()).toEqual(state);
    });

    it('keeps emulator ports distinct', () => {
        expect(new DataModelerProjectService('https://localhost:8081').projectUri.toString()).not.toBe(
            new DataModelerProjectService('https://localhost:8082').projectUri.toString(),
        );
    });

    it('prunes all states at least 30 days old on every save, preserving recent and unrelated files', async () => {
        const now = 2_000_000_000_000;
        vi.spyOn(Date, 'now').mockReturnValue(now);
        const old = new DataModelerProjectService('https://old.documents.azure.com');
        const boundary = new DataModelerProjectService('https://boundary.documents.azure.com');
        const recent = new DataModelerProjectService('https://recent.documents.azure.com');
        const unrelated = vscode.Uri.joinPath(service.folderUri, 'notes.json');
        for (const uri of [old.projectUri, boundary.projectUri, recent.projectUri, unrelated]) {
            files.set(uri.toString(), Buffer.from('{}'));
        }
        modifiedTimes.set(old.projectUri.toString(), now - DATA_MODELER_RETENTION_MS - 1);
        modifiedTimes.set(boundary.projectUri.toString(), now - DATA_MODELER_RETENTION_MS);
        modifiedTimes.set(recent.projectUri.toString(), now - DATA_MODELER_RETENTION_MS + 1);
        modifiedTimes.set(unrelated.toString(), 0);
        await service.loadState();
        await service.saveState(snapshot());
        expect(files.has(old.projectUri.toString())).toBe(false);
        expect(files.has(boundary.projectUri.toString())).toBe(false);
        expect(files.has(recent.projectUri.toString())).toBe(true);
        expect(files.has(unrelated.toString())).toBe(true);
        expect(vscode.workspace.fs.delete).toHaveBeenCalledWith(boundary.projectUri, {
            recursive: false,
            useTrash: false,
        });
        // Even saving this same endpoint again prunes entries that have expired since the last save.
        vi.mocked(Date.now).mockReturnValue(now + 1);
        await service.saveState(snapshot());
        expect(files.has(recent.projectUri.toString())).toBe(false);
        expect(files.has(service.projectUri.toString())).toBe(true);
    });

    it('does not restore an expired state and does not refresh age on reads', async () => {
        const now = 2_000_000_000_000;
        vi.spyOn(Date, 'now').mockReturnValue(now);
        await service.loadState();
        const state = snapshot();
        await service.saveState(state);
        vi.mocked(Date.now).mockReturnValue(now + DATA_MODELER_RETENTION_MS - 1);
        expect(await service.loadState()).toEqual(state);
        expect(modifiedTimes.get(service.projectUri.toString())).toBe(now);
        vi.mocked(Date.now).mockReturnValue(now + DATA_MODELER_RETENTION_MS);
        expect(await service.loadState()).toBeNull();
        expect(files.has(service.projectUri.toString())).toBe(false);
    });

    it('refreshes the retention period on each save', async () => {
        const now = 2_000_000_000_000;
        vi.spyOn(Date, 'now').mockReturnValue(now);
        await service.loadState();
        const state = snapshot();
        await service.saveState(state);
        vi.mocked(Date.now).mockReturnValue(now + DATA_MODELER_RETENTION_MS - 1);
        await service.saveState(state);
        vi.mocked(Date.now).mockReturnValue(now + DATA_MODELER_RETENTION_MS);
        expect(await service.loadState()).toEqual(state);
    });

    it('does not prune directories or symbolic links even when their names look like state files', async () => {
        const directory = 'a'.repeat(64) + '.json';
        const link = 'b'.repeat(64) + '.json';
        vi.mocked(vscode.workspace.fs.readDirectory).mockResolvedValue([
            [directory, vscode.FileType.Directory],
            [link, vscode.FileType.File | vscode.FileType.SymbolicLink],
        ]);
        await service.loadState();
        await service.saveState(snapshot());
        expect(vscode.workspace.fs.delete).not.toHaveBeenCalled();
    });

    it('surfaces pruning failures and retries cleanup on the next save', async () => {
        const expired = new DataModelerProjectService('https://expired.documents.azure.com').projectUri;
        files.set(expired.toString(), Buffer.from('{}'));
        modifiedTimes.set(expired.toString(), 0);
        await service.loadState();
        vi.mocked(vscode.workspace.fs.delete).mockRejectedValueOnce(vscode.FileSystemError.NoPermissions());
        await expect(service.saveState(snapshot())).rejects.toThrow(vscode.FileSystemError);
        expect(files.has(expired.toString())).toBe(true);
        await service.saveState(snapshot());
        expect(files.has(expired.toString())).toBe(false);
    });

    it('serializes pruning with other endpoints saving so a newly refreshed state is not deleted', async () => {
        const now = 2_000_000_000_000;
        vi.spyOn(Date, 'now').mockReturnValue(now);
        const second = new DataModelerProjectService('https://second.documents.azure.com');
        await service.loadState();
        await second.loadState();
        const state = snapshot();
        await second.saveState(state);
        vi.mocked(Date.now).mockReturnValue(now + DATA_MODELER_RETENTION_MS);
        await Promise.all([second.saveState(state), service.saveState(snapshot())]);
        expect(await second.loadState()).toEqual(state);
    });

    it.each([
        '',
        'invalid',
        'file:///C:/data',
        'https://user:secret@account.documents.azure.com',
        'https://account.documents.azure.com/?key=secret',
    ])('rejects invalid or credential-bearing endpoints without echoing them: %s', (value) => {
        expect(() => new DataModelerProjectService(value)).toThrow(
            'A valid Cosmos DB account endpoint is required to open the data modeler.',
        );
    });
});
