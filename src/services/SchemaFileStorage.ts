/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ext } from '../extensionVariables';

/**
 * Metadata stored in globalState for each schema.
 * The actual schema JSON is stored on disk in globalStorageUri/schemas/.
 */
export type SchemaMetadata = {
    id: string;
    name: string;
    generatedAt: string;
    documentCount: string;
};

const SCHEMA_METADATA_PREFIX = 'ms-azuretools.vscode-cosmosdb.schemaMetadata';

/**
 * Service for storing container schemas as files on disk instead of in VS Code's
 * globalState (SQLite), which has row-size limits that large schemas can exceed.
 *
 * - Schema JSON is written to `globalStorageUri/schemas/<schemaId>.json`
 * - Only small metadata (generatedAt, documentCount) is stored in globalState
 */
export class SchemaFileStorage {
    private static instance: SchemaFileStorage | undefined;

    public static getInstance(): SchemaFileStorage {
        if (!SchemaFileStorage.instance) {
            SchemaFileStorage.instance = new SchemaFileStorage();
        }
        return SchemaFileStorage.instance;
    }

    /**
     * Returns the URI of the schemas directory inside globalStorageUri.
     */
    private getSchemasDir(): vscode.Uri {
        return vscode.Uri.joinPath(ext.context.globalStorageUri, 'schemas');
    }

    /**
     * Returns the file URI for a given schema ID.
     */
    public getSchemaFileUri(schemaId: string): vscode.Uri {
        return vscode.Uri.joinPath(this.getSchemasDir(), `${schemaId}.json`);
    }

    /**
     * Returns the globalState key for a schema's metadata.
     */
    private getMetadataKey(schemaId: string): string {
        return `${SCHEMA_METADATA_PREFIX}/${schemaId}`;
    }

    /**
     * Ensures the schemas directory exists.
     */
    private async ensureSchemasDir(): Promise<void> {
        try {
            await vscode.workspace.fs.createDirectory(this.getSchemasDir());
        } catch {
            // Directory may already exist; ignore
        }
    }

    /**
     * Saves a schema: writes JSON to disk and metadata to globalState.
     */
    public async saveSchema(
        schemaId: string,
        name: string,
        schemaJson: string,
        generatedAt: string,
        documentCount: string,
    ): Promise<void> {
        await this.ensureSchemasDir();

        const fileUri = this.getSchemaFileUri(schemaId);
        // Pretty-print the JSON for readability since users can open the file directly
        const prettyJson = JSON.stringify(JSON.parse(schemaJson), null, 2);
        await vscode.workspace.fs.writeFile(fileUri, Buffer.from(prettyJson, 'utf8'));

        const metadata: SchemaMetadata = {
            id: schemaId,
            name,
            generatedAt,
            documentCount,
        };

        await ext.context.globalState.update(this.getMetadataKey(schemaId), metadata);
    }

    /**
     * Reads a schema's JSON from disk. Returns undefined if not found.
     */
    public async readSchema(schemaId: string): Promise<string | undefined> {
        const fileUri = this.getSchemaFileUri(schemaId);
        try {
            const data = await vscode.workspace.fs.readFile(fileUri);
            return Buffer.from(data).toString('utf8');
        } catch {
            return undefined;
        }
    }

    /**
     * Gets metadata for a single schema. Returns undefined if not found.
     */
    public getMetadata(schemaId: string): SchemaMetadata | undefined {
        return ext.context.globalState.get<SchemaMetadata>(this.getMetadataKey(schemaId));
    }

    /**
     * Gets all schema metadata entries.
     */
    public getAllMetadata(): SchemaMetadata[] {
        const prefix = `${SCHEMA_METADATA_PREFIX}/`;
        return ext.context.globalState
            .keys()
            .filter((key) => key.startsWith(prefix))
            .map((key) => ext.context.globalState.get<SchemaMetadata>(key))
            .filter((m): m is SchemaMetadata => m !== undefined);
    }

    /**
     * Returns all schema IDs.
     */
    public getAllSchemaIds(): string[] {
        const prefix = `${SCHEMA_METADATA_PREFIX}/`;
        return ext.context.globalState
            .keys()
            .filter((key) => key.startsWith(prefix))
            .map((key) => key.substring(prefix.length));
    }

    /**
     * Checks if a schema exists (has metadata in globalState).
     */
    public hasSchema(schemaId: string): boolean {
        return this.getMetadata(schemaId) !== undefined;
    }

    /**
     * Deletes a schema: removes the file from disk and metadata from globalState.
     */
    public async deleteSchema(schemaId: string): Promise<void> {
        // Remove file from disk
        const fileUri = this.getSchemaFileUri(schemaId);
        try {
            await vscode.workspace.fs.delete(fileUri);
        } catch {
            // File may not exist; ignore
        }

        // Remove metadata from globalState
        await ext.context.globalState.update(this.getMetadataKey(schemaId), undefined);
    }

    /**
     * Deletes all schemas: removes all files and metadata.
     */
    public async deleteAllSchemas(): Promise<void> {
        const ids = this.getAllSchemaIds();
        for (const id of ids) {
            await this.deleteSchema(id);
        }
    }

    /**
     * Migrates schemas from the old StorageService (globalState) to file-based storage.
     * After migration, the old globalState entries are removed.
     *
     * This method is idempotent and safe to call multiple times.
     */
    public async migrateFromGlobalState(oldStorageKey: string): Promise<void> {
        // The old storage uses keys like: `ms-azuretools.vscode-cosmosdb.default/<oldStorageKey>/<schemaId>`
        const storagePrefix = `ms-azuretools.vscode-cosmosdb.default/${oldStorageKey}/`;
        const keys = ext.context.globalState.keys().filter((key) => key.startsWith(storagePrefix));

        if (keys.length === 0) {
            return;
        }

        await this.ensureSchemasDir();

        for (const key of keys) {
            const schemaId = key.substring(storagePrefix.length);

            // Skip if already migrated
            if (this.hasSchema(schemaId)) {
                // Clean up old entry
                await ext.context.globalState.update(key, undefined);
                continue;
            }

            type OldSchemaItem = {
                id: string;
                name: string;
                properties: {
                    schema: string;
                    generatedAt: string;
                    documentCount: string;
                };
            };

            const oldItem = ext.context.globalState.get<OldSchemaItem>(key);
            if (!oldItem?.properties?.schema) {
                // Invalid entry, just clean up
                await ext.context.globalState.update(key, undefined);
                continue;
            }

            try {
                await this.saveSchema(
                    schemaId,
                    oldItem.name,
                    oldItem.properties.schema,
                    oldItem.properties.generatedAt,
                    oldItem.properties.documentCount,
                );

                // Remove old entry after successful migration
                await ext.context.globalState.update(key, undefined);
            } catch (error) {
                console.error(l10n.t('Failed to migrate schema "{0}":', schemaId), error);
                // Don't remove old entry if migration failed
            }
        }
    }
}
