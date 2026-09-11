/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { createHash, randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import { type AzureResourceMetadata } from '../cosmosdb/AzureResourceMetadata';
import { type CosmosDBControlPlane } from '../cosmosdb/controlPlane';
import {
    ModelingAdvisorProjectSchema,
    ModelingAdvisorSnapshotSchema,
    type ModelingAdvisorProject,
    type ModelingAdvisorSnapshot,
} from '../dataModeling/modelingAdvisorSchema';
import { ext } from '../extensionVariables';

export interface DataModelerAccount {
    endpoint: string;
    name?: string;
    /** Host-only deployment capability. Never serialized into wizard state or sent to the webview. */
    getControlPlane?: () => CosmosDBControlPlane;
    /** Host-only metadata for target display and Bicep defaults. The object itself is never serialized or persisted. */
    getDeploymentTarget?: () => AzureResourceMetadata | undefined;
}

export const DATA_MODELER_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const STATE_FILE_PATTERN = /^[a-f0-9]{64}\.json$/;

function accountStorageKey(endpoint: string): string {
    let url: URL;
    try {
        url = new URL(endpoint);
    } catch (error) {
        if (!(error instanceof TypeError)) {
            throw error;
        }
        throw new Error(l10n.t('A valid Cosmos DB account endpoint is required to open the data modeler.'));
    }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
        throw new Error(l10n.t('A valid Cosmos DB account endpoint is required to open the data modeler.'));
    }
    const normalized = url.origin + url.pathname.replace(/\/+$/, '');
    return createHash('sha256').update(normalized).digest('hex');
}

function isFileNotFound(error: unknown): boolean {
    return error instanceof vscode.FileSystemError && error.code === 'FileNotFound';
}

/** Persists local wizard inputs and results; never emits their contents, names, or paths to telemetry. */
export class DataModelerProjectService {
    private static readonly instances = new Map<string, DataModelerProjectService>();
    // Pruning visits every endpoint's file, so it must not race another endpoint's save.
    private static pending: Promise<unknown> = Promise.resolve();
    private loaded = false;
    public readonly folderUri: vscode.Uri;
    public readonly projectUri: vscode.Uri;

    public constructor(accountEndpoint: string, storageUri: vscode.Uri = ext.context.globalStorageUri) {
        this.folderUri = vscode.Uri.joinPath(storageUri, 'data-modeler');
        this.projectUri = vscode.Uri.joinPath(this.folderUri, `${accountStorageKey(accountEndpoint)}.json`);
    }

    /** Reuse the service for the same endpoint. Keys never go to telemetry. */
    public static getInstance(accountEndpoint: string): DataModelerProjectService {
        const key = accountStorageKey(accountEndpoint);
        let project = this.instances.get(key);
        if (!project) {
            project = new DataModelerProjectService(accountEndpoint);
            this.instances.set(key, project);
        }
        return project;
    }

    private enqueue<T>(operation: () => T | Promise<T>): Promise<T> {
        // A rejected write is reported to its caller, but must not prevent a subsequent retry.
        const result = DataModelerProjectService.pending.then(operation, operation);
        DataModelerProjectService.pending = result;
        return result;
    }

    public loadState(): Promise<ModelingAdvisorSnapshot | null> {
        return this.enqueue(async () => {
            const project = await this.readProject();
            this.loaded = true;
            if (!project) {
                return null;
            }
            const state = project.state;
            if (state.recommendation.status === 'waiting') {
                state.recommendation = {
                    ...state.recommendation,
                    status: 'error',
                    error: l10n.t(
                        'The previous recommendation request was interrupted. Request a recommendation again.',
                    ),
                };
            }
            return state;
        });
    }

    public saveState(snapshot: ModelingAdvisorSnapshot): Promise<void> {
        return this.enqueue(async () => {
            if (!this.loaded) {
                throw new Error(l10n.t('Load the saved data model before saving changes.'));
            }
            const parsed = ModelingAdvisorSnapshotSchema.safeParse(snapshot);
            if (!parsed.success) {
                throw new Error(l10n.t('The data modeler state is invalid and could not be saved.'));
            }
            // Re-read before replacing so an externally damaged or newer-version file is never silently discarded.
            const existing = await this.readProject();
            const state = parsed.data;
            await this.writeProject({ version: 1, name: existing?.name ?? 'Data Modeler', state });
            await this.pruneExpiredStates();
        });
    }

    private async readProject(): Promise<ModelingAdvisorProject | undefined> {
        if (await this.deleteIfExpired(this.projectUri, Date.now() - DATA_MODELER_RETENTION_MS)) {
            return undefined;
        }
        let bytes: Uint8Array;
        try {
            bytes = await vscode.workspace.fs.readFile(this.projectUri);
        } catch (error) {
            if (isFileNotFound(error)) {
                return undefined;
            }
            throw error;
        }
        let json: unknown;
        try {
            json = JSON.parse(Buffer.from(bytes).toString('utf8'));
        } catch (error) {
            if (!(error instanceof SyntaxError)) {
                throw error;
            }
            throw new Error(l10n.t('The saved data modeler project is not valid JSON. Fix the file before retrying.'));
        }
        const parsed = ModelingAdvisorProjectSchema.safeParse(json);
        if (!parsed.success) {
            throw new Error(
                l10n.t(
                    'The saved data modeler project has an invalid format or unsupported version. The file was not changed.',
                ),
            );
        }
        return parsed.data;
    }

    private async pruneExpiredStates(): Promise<void> {
        const cutoff = Date.now() - DATA_MODELER_RETENTION_MS;
        const entries = await vscode.workspace.fs.readDirectory(this.folderUri);
        for (const [name, type] of entries) {
            if (type === vscode.FileType.File && STATE_FILE_PATTERN.test(name)) {
                await this.deleteIfExpired(vscode.Uri.joinPath(this.folderUri, name), cutoff);
            }
        }
    }

    /** Missing files are also absent for loading; all other filesystem failures are surfaced to the caller. */
    private async deleteIfExpired(uri: vscode.Uri, cutoff: number): Promise<boolean> {
        try {
            const stat = await vscode.workspace.fs.stat(uri);
            if (stat.type === vscode.FileType.File && stat.mtime <= cutoff) {
                await vscode.workspace.fs.delete(uri, { recursive: false, useTrash: false });
                return true;
            }
            return false;
        } catch (error) {
            if (isFileNotFound(error)) {
                return true;
            }
            throw error;
        }
    }

    private async writeProject(project: ModelingAdvisorProject): Promise<void> {
        await vscode.workspace.fs.createDirectory(this.folderUri);
        const temporaryUri = vscode.Uri.joinPath(this.folderUri, `${randomUUID()}.tmp`);
        try {
            await vscode.workspace.fs.writeFile(temporaryUri, Buffer.from(JSON.stringify(project, null, 2) + '\n'));
            await vscode.workspace.fs.rename(temporaryUri, this.projectUri, { overwrite: true });
        } catch (error) {
            try {
                await vscode.workspace.fs.delete(temporaryUri);
            } catch (cleanupError) {
                if (!isFileNotFound(cleanupError)) {
                    ext.outputChannel.warn(
                        'Could not remove a temporary data modeler project file after a failed save.',
                    );
                }
            }
            throw error;
        }
    }
}
