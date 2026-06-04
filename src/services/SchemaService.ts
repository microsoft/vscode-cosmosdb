/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type JSONSchema } from '@cosmosdb/schema-analyzer';
import {
    getSchemaFromDocument,
    getSchemaFromDocuments,
    simplifySchema,
    updateSchemaWithDocument,
    type NoSQLDocument,
} from '@cosmosdb/schema-analyzer/json';
import { callWithTelemetryAndErrorHandling, parseError, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { type NoSqlQueryConnection } from '../cosmosdb/NoSqlQueryConnection';
import { withClaimsChallengeHandling } from '../cosmosdb/withClaimsChallengeHandling';
import { ext } from '../extensionVariables';
import { SchemaFileStorage, type SchemaMetadata } from './SchemaFileStorage';

// ─── Constants ──────────────────────────────────────────────────────────────

/**
 * Threshold above which a generated/merged schema is considered too large to
 * store verbatim. When the size exceeds this value, the service automatically
 * runs aggressive simplification before persisting and sets
 * {@link SchemaMetadata.wasSimplifiedOnSave} to `true`.
 *
 * Lowered from 50 MB to 5 MB so the on-disk artifact is small enough to be
 * fed into the language model context without further pruning in most cases.
 */
export const SCHEMA_SIZE_LIMIT_BYTES = 5 * 1024 * 1024;

/** Maximum number of documents to inspect during {@link SchemaService.generateAndSaveSchema}. */
export const MAX_SCHEMA_DOCUMENT_LIMIT = 100_000;

/** Page size for the underlying CosmosDB query when generating a schema. */
const SCHEMA_GENERATION_PAGE_SIZE = 1000;

/** Defaults for {@link SimplifiedSchemaOptions}. */
// 50 KB ≈ 12-15 K tokens with a typical JSON-friendly tokenizer — comfortably
// below the per-request budget any current model gives us, and small enough
// that the schema is rarely the dominant cost in the prompt. Tuned down from
// 500 KB (~100 K tokens) which was burning context for no real recall gain.
export const DEFAULT_SIMPLIFIED_TARGET_BYTES = 50 * 1024;
export const DEFAULT_SIMPLIFIED_MAX_DEPTH = 3;
export const DEFAULT_SIMPLIFIED_KEEP_TOP_N = 2;
/**
 * Floor applied to the adaptive root trim (depth 0).
 *
 * The simplifier never reduces the schema root below this many entries,
 * even if doing so means a slight budget overflow.  When there is headroom
 * the simplifier binary-searches *upwards* from this floor and keeps as
 * many additional root entries as the byte budget allows — i.e. this
 * number is a guarantee, not a cap.
 *
 * Reason: real-world Cosmos containers routinely have 10-30 "universally
 * occurring" top-level fields (id, partition key, common metadata, …) plus
 * a long tail of rare polymorphic additions.  Reducing the root to just
 * `keepTopN` = 2 turns the simplified schema into `{ id, _partitionKey }`,
 * which is useless to an LLM trying to suggest queries against the
 * container.  By contrast, deeper levels can stay aggressive: nested
 * objects rarely host a long tail worth surfacing once the parent name is
 * already in scope.
 */
export const DEFAULT_SIMPLIFIED_ROOT_KEEP_TOP_N = 50;
export const DEFAULT_POPULARITY_KEY = 'x-occurrence';

/**
 * `x-*` extensions that are stripped from schemas before they are handed to
 * the language model: they are dense statistics that the LLM cannot use
 * meaningfully, and they consume the majority of bytes in deep schemas.
 *
 * `x-occurrence`, `x-typeOccurrence`, `x-dataType` and `x-bsonType` are kept
 * because the popularity cut depends on them and because the schema format
 * documentation (see `packages/schema-analyzer/docs/schema-format.md`) treats
 * `x-dataType` / `x-bsonType` as part of the public type tag.
 */
const NOISY_STAT_KEYS = new Set<string>([
    'x-documentsInspected',
    'x-minProperties',
    'x-maxProperties',
    'x-minItems',
    'x-maxItems',
    'x-minLength',
    'x-maxLength',
    'x-minValue',
    'x-maxValue',
    'x-minDate',
    'x-maxDate',
    'x-trueCount',
    'x-falseCount',
]);

// ─── Public types ───────────────────────────────────────────────────────────

/**
 * Identifier for the high-level action that triggered a schema mutation. Used
 * as a telemetry property so we can compare engagement across surfaces
 * without leaking database or container names.
 */
export type SchemaWriteSource =
    | 'manualGenerate'
    | 'queryMerge'
    | 'aiSample'
    | 'documentWrite'
    | 'manualDelete'
    | 'cascadeDelete';

/**
 * Options accepted by every {@link SchemaService} mutation.
 *
 * - `suppressNotification`: when `true`, no popups are shown. Confirmation
 *   prompts default to "no/cancel" unless `confirmAll` is also set. Info and
 *   warning messages are written to the output channel instead.
 * - `confirmAll`: only meaningful when `suppressNotification` is `true`.
 *   Flips the default answer for confirmation prompts to "yes/continue" so
 *   that automated paths (cascade deletion, background merges) can proceed.
 * - `source`: the calling surface, recorded in telemetry.
 * - `actionContext`: when the caller is already inside
 *   `callWithTelemetryAndErrorHandling`, the service forwards properties
 *   onto that context rather than creating a nested one.
 * - `updateFromQueriesEnabled`: only meaningful for incremental writes
 *   ({@link SchemaService.mergeDocumentsIntoSchema}). When `true`, the
 *   service preserves the original sample size in
 *   {@link SchemaMetadata.initialDocumentCount} and stops counting subsequent
 *   documents — the schema becomes "query-driven" and the running count is
 *   no longer meaningful.
 */
export interface SchemaWriteOptions {
    suppressNotification?: boolean;
    confirmAll?: boolean;
    source: SchemaWriteSource;
    actionContext?: IActionContext;
    updateFromQueriesEnabled?: boolean;
}

export interface SchemaWriteResult {
    schema: JSONSchema;
    metadata: SchemaMetadata;
    cancelled?: boolean;
    /** Number of documents inspected during this write. */
    documentsInspectedInWrite: number;
    /** `true` when the persisted schema was passed through aggressive simplification. */
    wasSimplifiedOnSave: boolean;
}

/**
 * Tuning knobs for {@link SchemaService.getSimplifiedSchema}. All numbers
 * have permissive defaults so callers that don't care can ignore the
 * argument.
 */
export interface SimplifiedSchemaOptions {
    /** Target byte budget — simplification stops once the JSON-encoded schema is at or below this size. */
    targetSizeBytes?: number;
    /** Hard depth cap applied after the popularity cut if size is still over budget. */
    maxDepth?: number;
    /** Number of most popular children to keep at each level when doing the popularity cut. */
    keepTopN?: number;
    /**
     * **Floor** for the number of root entries kept by the adaptive root
     * trim.  Even when keeping this many entries already exceeds
     * {@link targetSizeBytes}, the simplifier still keeps them — this
     * guarantees the AI always sees at least N stable top-level fields
     * (id, partition key, common metadata, …) regardless of the byte
     * budget.
     *
     * When there is headroom in the budget the simplifier binary-searches
     * upwards and keeps as many additional (less popular) root entries as
     * the budget allows.  The actual final count is therefore
     * `≥ rootKeepTopN` and only goes higher.
     *
     * Defaults to {@link DEFAULT_SIMPLIFIED_ROOT_KEEP_TOP_N}.
     */
    rootKeepTopN?: number;
    /** Name of the `x-*` field used to rank popularity. */
    popularityKey?: string;
}

export interface SimplifiedSchemaResult {
    schema: JSONSchema;
    metadata: SchemaMetadata;
    originalSizeBytes: number;
    simplifiedSizeBytes: number;
    wasSimplified: boolean;
    /** `true` when the popularity-based cut had data to work with (i.e. the schema carried the configured popularity counter). */
    popularityKeyHit: boolean;
}

/**
 * Event emitted by {@link SchemaService.onSchemaChanged} whenever the
 * persistent schema for a container is updated or removed. Subscribers
 * (e.g. open query-editor tabs) are expected to re-read the schema and
 * refresh whatever derived state they own (Monaco autocomplete, status
 * bar entries, etc.). The event itself is intentionally lean — it does
 * not ship the schema payload so subscribers stay in control of when to
 * pay the deserialization cost.
 */
export interface SchemaChangedEvent {
    /**
     * `saved` covers generate / merge / cascade-into-merge. `deleted` covers
     * manual deletion as well as the cascading cleanups triggered when a
     * container or database is removed.
     */
    type: 'saved' | 'deleted';
    endpoint: string;
    databaseId: string;
    containerId: string;
    source: SchemaWriteSource;
}

// ─── Service ────────────────────────────────────────────────────────────────

/**
 * Single entry point for every code path that needs to read, write, simplify
 * or delete a container schema. Wraps {@link SchemaFileStorage} so that
 * notification policy, telemetry and the size guard live in one place.
 *
 * The service is intentionally a thin orchestration layer — heavy lifting
 * (BFS schema construction, popularity-based pruning) lives in standalone
 * helpers below to keep them testable.
 */
export class SchemaService {
    private static instance: SchemaService | undefined;

    public static getInstance(): SchemaService {
        if (!SchemaService.instance) {
            SchemaService.instance = new SchemaService();
        }
        return SchemaService.instance;
    }

    private readonly schemaChangedEmitter = new vscode.EventEmitter<SchemaChangedEvent>();

    /**
     * Fired after a successful save or delete (including cascading deletes).
     * Subscribers must perform their own filtering by endpoint/database/container
     * because the service broadcasts every change.
     */
    public readonly onSchemaChanged: vscode.Event<SchemaChangedEvent> = this.schemaChangedEmitter.event;

    private emitSchemaChanged(event: SchemaChangedEvent): void {
        try {
            this.schemaChangedEmitter.fire(event);
        } catch (error) {
            // A misbehaving subscriber must never break the underlying schema
            // write — log and move on.
            ext.outputChannel.warn(l10n.t('[Schema] onSchemaChanged subscriber threw: {0}', String(error)));
        }
    }

    private get storage(): SchemaFileStorage {
        return SchemaFileStorage.getInstance();
    }

    // ── Read ────────────────────────────────────────────────────────────

    /**
     * Returns the persisted schema for `connection`, or `null` when none has
     * been generated. Safe to call from hot paths — it parses but does not
     * mutate.
     */
    public async readSchema(connection: NoSqlQueryConnection): Promise<JSONSchema | null> {
        const schemaId = SchemaFileStorage.getSchemaIdForConnection(connection);
        const json = await this.storage.readSchema(schemaId);
        return json ? (JSON.parse(json) as JSONSchema) : null;
    }

    public getMetadata(connection: NoSqlQueryConnection): SchemaMetadata | undefined {
        const schemaId = SchemaFileStorage.getSchemaIdForConnection(connection);
        return this.storage.getMetadata(schemaId);
    }

    // ── Generate ────────────────────────────────────────────────────────

    /**
     * Generates the schema for `connection` by issuing a `SELECT * FROM c`
     * (with optional `TOP`) query, accumulating it across paginated batches
     * and persisting the result.
     *
     * Returns `undefined` when the user cancels the upfront confirmation or
     * when there are no documents in the container.
     */
    public async generateAndSaveSchema(
        connection: NoSqlQueryConnection,
        requestedLimit: number | undefined,
        options: SchemaWriteOptions,
    ): Promise<SchemaWriteResult | undefined> {
        const effectiveLimit =
            requestedLimit === undefined
                ? MAX_SCHEMA_DOCUMENT_LIMIT
                : Math.min(requestedLimit, MAX_SCHEMA_DOCUMENT_LIMIT);

        const schemaId = SchemaFileStorage.getSchemaIdForConnection(connection);
        const containerLabel = `${connection.databaseId}/${connection.containerId}`;
        const limitLabel = requestedLimit
            ? l10n.t('TOP {0}', effectiveLimit)
            : l10n.t('ALL (up to {0})', MAX_SCHEMA_DOCUMENT_LIMIT);

        const hasExistingSchema = this.storage.hasSchema(schemaId);

        const warningParts: string[] = [
            l10n.t(
                'Generating schema from {0} documents will execute a query against your Azure Cosmos DB container, which consumes Request Units (RUs).',
                limitLabel,
            ),
        ];

        if (hasExistingSchema) {
            warningParts.push(l10n.t('The previously saved schema for this container will be replaced.'));
        }

        warningParts.push(l10n.t('Are you sure you want to continue?'));

        const continueConfirmed = await this.confirm({
            options,
            message: warningParts.join('\n'),
            confirmLabel: l10n.t('Continue'),
            logPrefix: l10n.t('[Schema] Generate confirmation for {0}', containerLabel),
        });

        if (!continueConfirmed) {
            ext.outputChannel.appendLog(l10n.t('[Schema] Generation for {0} was cancelled.', containerLabel));
            return undefined;
        }

        const query =
            effectiveLimit < MAX_SCHEMA_DOCUMENT_LIMIT ? `SELECT TOP ${effectiveLimit} * FROM c` : `SELECT * FROM c`;

        const result = await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: l10n.t('Generating schema for {0}', containerLabel),
                cancellable: true,
            },
            async (progress, token) => {
                const iterator = await withClaimsChallengeHandling(connection, (client) =>
                    Promise.resolve(
                        client
                            .database(connection.databaseId)
                            .container(connection.containerId)
                            .items.query(query, { maxItemCount: SCHEMA_GENERATION_PAGE_SIZE }),
                    ),
                );

                let schema: JSONSchema = {};
                let totalDocCount = 0;
                let isFirstDoc = true;

                while (iterator.hasMoreResults() && totalDocCount < effectiveLimit) {
                    if (token.isCancellationRequested) {
                        break;
                    }

                    // oxlint-disable-next-line no-await-in-loop
                    const page = await iterator.fetchNext();
                    const documents = page.resources ?? [];

                    if (documents.length === 0) {
                        break;
                    }

                    for (const doc of documents) {
                        if (totalDocCount >= effectiveLimit) {
                            break;
                        }

                        if (isFirstDoc) {
                            schema = getSchemaFromDocument(doc as NoSQLDocument);
                            isFirstDoc = false;
                        } else {
                            updateSchemaWithDocument(schema, doc as NoSQLDocument);
                        }
                        totalDocCount++;
                    }

                    progress.report({
                        message: l10n.t('{0} documents processed', totalDocCount),
                        increment: effectiveLimit ? (documents.length / effectiveLimit) * 100 : undefined,
                    });
                }

                return { schema, totalDocCount, cancelled: token.isCancellationRequested };
            },
        );

        const { schema, totalDocCount, cancelled } = result;

        if (totalDocCount === 0) {
            this.notifyInfo(
                options,
                l10n.t('No documents found in the container. Schema was not generated.'),
                `[Schema] No documents in ${containerLabel} — nothing to generate`,
            );
            return undefined;
        }

        simplifySchema(schema);

        const persisted = await this.persistWithSizeGuard({
            schema,
            connection,
            schemaId,
            containerLabel,
            options,
            isFreshGeneration: true,
            sampleSize: totalDocCount,
        });

        if (cancelled) {
            this.notifyInfo(
                options,
                l10n.t(
                    'Schema generation was cancelled. Partial schema from {0} documents has been saved for {1}.',
                    totalDocCount,
                    containerLabel,
                ),
                `[Schema] Cancelled by user, saved partial schema (${totalDocCount} docs) for ${containerLabel}`,
            );
        } else {
            this.notifyInfo(
                options,
                l10n.t('Schema generated from {0} documents and saved for {1}.', totalDocCount, containerLabel),
                `[Schema] Generated from ${totalDocCount} docs and saved for ${containerLabel}`,
            );
        }

        this.reportSchemaTelemetry({
            event: 'cosmosDB.nosql.schema.generate',
            options,
            metadata: persisted.metadata,
            schemaJson: persisted.schemaJson,
            documentsInspectedInWrite: totalDocCount,
            wasSimplifiedOnSave: persisted.wasSimplifiedOnSave,
            cancelled,
        });

        this.emitSchemaChanged({
            type: 'saved',
            endpoint: connection.endpoint,
            databaseId: connection.databaseId,
            containerId: connection.containerId,
            source: options.source,
        });

        return {
            schema: persisted.schema,
            metadata: persisted.metadata,
            cancelled,
            documentsInspectedInWrite: totalDocCount,
            wasSimplifiedOnSave: persisted.wasSimplifiedOnSave,
        };
    }

    // ── Incremental merge ───────────────────────────────────────────────

    /**
     * Merges `documents` into the saved schema for `connection`. Used by
     *
     * - the query editor when "generate schema based on queries" is on,
     * - the document editor after a successful creation,
     * - the AI sampling tool.
     *
     * When `options.updateFromQueriesEnabled` is `true`, the running document
     * count is "frozen" on the first incremental call: the previous total is
     * snapshotted into {@link SchemaMetadata.initialDocumentCount} and
     * subsequent merges no longer increment {@link SchemaMetadata.documentCount}.
     */
    public async mergeDocumentsIntoSchema(
        connection: NoSqlQueryConnection,
        documents: NoSQLDocument[],
        options: SchemaWriteOptions,
    ): Promise<SchemaWriteResult | undefined> {
        if (documents.length === 0) {
            return undefined;
        }

        const schemaId = SchemaFileStorage.getSchemaIdForConnection(connection);
        const containerLabel = `${connection.databaseId}/${connection.containerId}`;

        const existingMetadata = this.storage.getMetadata(schemaId);
        const existingSchemaJson = existingMetadata ? await this.storage.readSchema(schemaId) : undefined;

        let schema: JSONSchema;
        let previousDocCount = 0;
        const isBootstrap = !existingSchemaJson;

        if (existingSchemaJson) {
            schema = JSON.parse(existingSchemaJson) as JSONSchema;
            previousDocCount = parseInt(existingMetadata!.documentCount, 10) || 0;
            for (const doc of documents) {
                updateSchemaWithDocument(schema, doc);
            }
        } else {
            // No existing schema — bootstrap from the supplied batch in one
            // pass using the bulk constructor, then continue with the merge
            // pipeline so options/telemetry/notifications fire the same way.
            schema = getSchemaFromDocuments(documents);
        }

        const docsAdded = documents.length;
        simplifySchema(schema);

        const persisted = await this.persistWithSizeGuard({
            schema,
            connection,
            schemaId,
            containerLabel,
            options,
            isFreshGeneration: isBootstrap,
            sampleSize: previousDocCount + docsAdded,
            previousMetadata: existingMetadata,
        });

        this.reportSchemaTelemetry({
            event: 'cosmosDB.nosql.schema.merge',
            options,
            metadata: persisted.metadata,
            schemaJson: persisted.schemaJson,
            documentsInspectedInWrite: docsAdded,
            wasSimplifiedOnSave: persisted.wasSimplifiedOnSave,
        });

        this.emitSchemaChanged({
            type: 'saved',
            endpoint: connection.endpoint,
            databaseId: connection.databaseId,
            containerId: connection.containerId,
            source: options.source,
        });

        return {
            schema: persisted.schema,
            metadata: persisted.metadata,
            documentsInspectedInWrite: docsAdded,
            wasSimplifiedOnSave: persisted.wasSimplifiedOnSave,
        };
    }

    // ── Simplification for AI ───────────────────────────────────────────

    /**
     * Returns a copy of the saved schema, aggressively pruned so that it fits
     * the language-model context budget. Never mutates the on-disk version.
     *
     * Strategy (deferred until the schema is over budget):
     * 1. Strip noisy `x-*` statistics.
     * 2. Wave-by-wave popularity cut: at each depth (deepest first) keep
     *    only the top `keepTopN` children, ranked by `popularityKey`.
     * 3. Hard depth cut: remove anything deeper than `maxDepth`.
     *
     * Returns `null` when there is no stored schema for `connection`.
     */
    public async getSimplifiedSchema(
        connection: NoSqlQueryConnection,
        rawOptions?: SimplifiedSchemaOptions,
    ): Promise<SimplifiedSchemaResult | null> {
        const stored = await this.readSchema(connection);
        const metadata = this.getMetadata(connection);
        if (!stored || !metadata) {
            return null;
        }

        const options: Required<SimplifiedSchemaOptions> = {
            targetSizeBytes: rawOptions?.targetSizeBytes ?? DEFAULT_SIMPLIFIED_TARGET_BYTES,
            maxDepth: rawOptions?.maxDepth ?? DEFAULT_SIMPLIFIED_MAX_DEPTH,
            keepTopN: rawOptions?.keepTopN ?? DEFAULT_SIMPLIFIED_KEEP_TOP_N,
            rootKeepTopN: rawOptions?.rootKeepTopN ?? DEFAULT_SIMPLIFIED_ROOT_KEEP_TOP_N,
            popularityKey: rawOptions?.popularityKey ?? DEFAULT_POPULARITY_KEY,
        };

        // Heavy lifting (sizing + simplification) runs inside the telemetry
        // wrapper so that any throw from `jsonByteSize` / `aggressivelySimplify`
        // is captured and reported, and `suppressDisplay` actually has meaning.
        const result = await callWithTelemetryAndErrorHandling(
            'cosmosDB.nosql.schema.getSimplified',
            (ctx): SimplifiedSchemaResult => {
                ctx.errorHandling.suppressDisplay = true;

                const originalSizeBytes = jsonByteSize(stored);
                const { schema: simplified, popularityKeyHit, wasSimplified } = aggressivelySimplify(stored, options);
                const simplifiedSizeBytes = jsonByteSize(simplified);

                ctx.telemetry.properties.popularityKeyHit = String(popularityKeyHit);
                ctx.telemetry.properties.wasSimplified = String(wasSimplified);
                ctx.telemetry.properties.depthBudget = options.maxDepth.toString();
                ctx.telemetry.properties.keepTopN = options.keepTopN.toString();
                ctx.telemetry.measurements.originalSizeBytes = originalSizeBytes;
                ctx.telemetry.measurements.simplifiedSizeBytes = simplifiedSizeBytes;
                ctx.telemetry.measurements.targetSizeBytes = options.targetSizeBytes;

                return {
                    schema: simplified,
                    metadata,
                    originalSizeBytes,
                    simplifiedSizeBytes,
                    wasSimplified,
                    popularityKeyHit,
                };
            },
        );

        return result ?? null;
    }

    // ── Delete ──────────────────────────────────────────────────────────

    /**
     * Deletes the schema for `connection`. When `options.suppressNotification`
     * is `false`, the user is asked for confirmation.
     */
    public async deleteSchema(connection: NoSqlQueryConnection, options: SchemaWriteOptions): Promise<boolean> {
        const schemaId = SchemaFileStorage.getSchemaIdForConnection(connection);
        const containerLabel = `${connection.databaseId}/${connection.containerId}`;

        if (!this.storage.hasSchema(schemaId)) {
            this.notifyInfo(
                options,
                l10n.t('No schema found for {0}.', containerLabel),
                `[Schema] Nothing to delete for ${containerLabel}`,
            );
            return false;
        }

        const confirmed = await this.confirm({
            options,
            message: l10n.t(
                'Are you sure you want to delete the schema for {0}? The schema file will be permanently removed from disk. To get the schema back, you will need to generate it again.',
                containerLabel,
            ),
            confirmLabel: l10n.t('Delete'),
            logPrefix: l10n.t('[Schema] Delete confirmation for {0}', containerLabel),
        });

        if (!confirmed) {
            ext.outputChannel.appendLog(l10n.t('[Schema] Deletion for {0} was cancelled.', containerLabel));
            return false;
        }

        await this.storage.deleteSchema(schemaId);

        this.notifyInfo(
            options,
            l10n.t('Schema for {0} has been deleted.', containerLabel),
            `[Schema] Deleted schema for ${containerLabel}`,
        );

        void callWithTelemetryAndErrorHandling('cosmosDB.nosql.schema.delete', (ctx) => {
            ctx.telemetry.properties.source = options.source;
        });

        this.emitSchemaChanged({
            type: 'deleted',
            endpoint: connection.endpoint,
            databaseId: connection.databaseId,
            containerId: connection.containerId,
            source: options.source,
        });

        return true;
    }

    /**
     * Removes every schema persisted for `(endpoint, databaseId, containerId)`.
     * Best-effort — individual failures are logged but never thrown so that
     * cascading container/database deletion never appears to "fail" because of
     * a stale schema artifact.
     */
    public async deleteSchemasForContainer(endpoint: string, databaseId: string, containerId: string): Promise<void> {
        try {
            const matches = this.storage.findSchemasForContainer(endpoint, databaseId, containerId);
            await this.deleteByMatches(matches, `${databaseId}/${containerId}`, 'container');
        } catch (error) {
            ext.outputChannel.warn(
                l10n.t('Failed to delete cached schema for the removed container: {0}', String(error)),
            );
        }
    }

    /**
     * Removes every schema persisted for any container under
     * `(endpoint, databaseId)`. Best-effort.
     */
    public async deleteSchemasForDatabase(endpoint: string, databaseId: string): Promise<void> {
        try {
            const matches = this.storage.findSchemasForDatabase(endpoint, databaseId);
            await this.deleteByMatches(matches, databaseId, 'database');
        } catch (error) {
            ext.outputChannel.warn(
                l10n.t('Failed to delete cached schemas for the removed database: {0}', String(error)),
            );
        }
    }

    /**
     * `scope` reflects the *caller's* intent (`'container'` for a container
     * delete, `'database'` for a database delete) — it is **not** derived
     * from `matches.length`. A container cascade with stray legacy entries
     * must still be reported as `'container'`, and a database cascade with
     * a single match must still be reported as `'database'`. Telemetry is
     * emitted **once per call**, not once per match, with `deletedCount`
     * and `errorCount` measurements.
     */
    private async deleteByMatches(
        matches: SchemaMetadata[],
        label: string,
        scope: 'container' | 'database',
    ): Promise<void> {
        if (matches.length === 0) {
            return;
        }

        let deletedCount = 0;
        let errorCount = 0;

        for (const match of matches) {
            try {
                await this.storage.deleteSchema(match.id);
                deletedCount++;
                ext.outputChannel.appendLog(
                    l10n.t('[Schema] Cascaded delete: removed schema "{0}" for {1}', match.name, label),
                );

                if (match.endpoint && match.databaseId && match.containerId) {
                    this.emitSchemaChanged({
                        type: 'deleted',
                        endpoint: match.endpoint,
                        databaseId: match.databaseId,
                        containerId: match.containerId,
                        source: 'cascadeDelete',
                    });
                }
            } catch (error) {
                errorCount++;
                ext.outputChannel.warn(
                    l10n.t(
                        '[Schema] Cascaded delete failed for "{0}" ({1}): {2}',
                        match.name,
                        label,
                        parseError(error).message,
                    ),
                );
            }
        }

        void callWithTelemetryAndErrorHandling('cosmosDB.nosql.schema.cascadeDelete', (ctx) => {
            ctx.errorHandling.suppressDisplay = true;
            ctx.errorHandling.rethrow = false;
            ctx.telemetry.properties.scope = scope;
            ctx.telemetry.measurements.deletedCount = deletedCount;
            ctx.telemetry.measurements.errorCount = errorCount;
        });
    }

    // ── Notification / confirmation helpers ─────────────────────────────

    /**
     * Resolves to `true` when the user (or the suppression policy) approves
     * continuing. The output channel always receives a record of the choice.
     */
    private async confirm(args: {
        options: SchemaWriteOptions;
        message: string;
        confirmLabel: string;
        logPrefix: string;
    }): Promise<boolean> {
        const { options, message, confirmLabel, logPrefix } = args;
        ext.outputChannel.appendLog(`${logPrefix}\n${message}`);

        if (options.suppressNotification) {
            const decision = options.confirmAll === true;
            ext.outputChannel.appendLog(
                decision
                    ? l10n.t('[Schema] Auto-confirmed (confirmAll).')
                    : l10n.t('[Schema] Auto-cancelled (suppressNotification without confirmAll).'),
            );
            return decision;
        }

        const continueItem: vscode.MessageItem = { title: confirmLabel };
        const cancelItem: vscode.MessageItem = { title: l10n.t('Cancel'), isCloseAffordance: true };
        const choice = await vscode.window.showWarningMessage(message, { modal: true }, continueItem, cancelItem);
        return choice === continueItem;
    }

    private notifyInfo(options: SchemaWriteOptions, message: string, logLine: string): void {
        ext.outputChannel.appendLog(logLine);
        if (!options.suppressNotification) {
            void vscode.window.showInformationMessage(message);
        }
    }

    // ── Persistence with the 5 MB guard ─────────────────────────────────

    /**
     * Writes the schema for `connection` to disk, enforcing the 5 MB cap by
     * aggressively simplifying when the JSON-encoded payload is over budget.
     * Updates {@link SchemaMetadata} with the new flags.
     */
    private async persistWithSizeGuard(args: {
        schema: JSONSchema;
        connection: NoSqlQueryConnection;
        schemaId: string;
        containerLabel: string;
        options: SchemaWriteOptions;
        isFreshGeneration: boolean;
        sampleSize: number;
        previousMetadata?: SchemaMetadata;
    }): Promise<{
        schema: JSONSchema;
        schemaJson: string;
        metadata: SchemaMetadata;
        wasSimplifiedOnSave: boolean;
    }> {
        const {
            schema,
            connection,
            schemaId,
            containerLabel,
            options,
            isFreshGeneration,
            sampleSize,
            previousMetadata,
        } = args;

        let workingSchema: JSONSchema = schema;
        let workingJson = JSON.stringify(workingSchema);
        let workingJsonBytes = Buffer.byteLength(workingJson, 'utf8');
        let wasSimplifiedOnSave = false;

        if (workingJsonBytes > SCHEMA_SIZE_LIMIT_BYTES) {
            const originalSizeMB = (workingJsonBytes / (1024 * 1024)).toFixed(1);
            const limitMB = (SCHEMA_SIZE_LIMIT_BYTES / (1024 * 1024)).toFixed(0);
            ext.outputChannel.warn(
                l10n.t(
                    '[Schema] Generated schema for {0} is {1} MB (over {2} MB limit); auto-simplifying before save.',
                    containerLabel,
                    originalSizeMB,
                    limitMB,
                ),
            );

            const simplified = aggressivelySimplify(workingSchema, {
                targetSizeBytes: SCHEMA_SIZE_LIMIT_BYTES,
                maxDepth: DEFAULT_SIMPLIFIED_MAX_DEPTH,
                keepTopN: DEFAULT_SIMPLIFIED_KEEP_TOP_N,
                rootKeepTopN: DEFAULT_SIMPLIFIED_ROOT_KEEP_TOP_N,
                popularityKey: DEFAULT_POPULARITY_KEY,
            });
            workingSchema = simplified.schema;
            workingJson = JSON.stringify(workingSchema);
            workingJsonBytes = Buffer.byteLength(workingJson, 'utf8');
            wasSimplifiedOnSave = true;

            // The simplifier honours `rootKeepTopN` as a *floor*, so a wide,
            // shallow schema whose top-N retained children alone exceed the
            // limit can come back still over budget. Persist it anyway —
            // losing data is worse than overshooting — but be honest about
            // what actually happened in both the log and the user-facing
            // message.
            const stillOverLimit = workingJsonBytes > SCHEMA_SIZE_LIMIT_BYTES;
            const simplifiedSizeMB = (workingJsonBytes / (1024 * 1024)).toFixed(1);

            if (stillOverLimit) {
                ext.outputChannel.warn(
                    l10n.t(
                        '[Schema] Simplification reduced {0} from {1} MB to {2} MB, but it is still over the {3} MB limit. Saving anyway.',
                        containerLabel,
                        originalSizeMB,
                        simplifiedSizeMB,
                        limitMB,
                    ),
                );
            }

            if (!options.suppressNotification) {
                const message = stillOverLimit
                    ? l10n.t(
                          'The generated schema for {0} is {1} MB even after simplification (limit: {2} MB). Saving it anyway — consider narrowing the data shape if AI suggestions feel imprecise.',
                          containerLabel,
                          simplifiedSizeMB,
                          limitMB,
                      )
                    : l10n.t(
                          'The generated schema was larger than {0} MB. It has been automatically simplified before saving for {1}.',
                          limitMB,
                          containerLabel,
                      );
                void vscode.window.showInformationMessage(message);
            }
        }

        const metadata = composeMetadata({
            schemaId,
            containerLabel,
            connection,
            sampleSize,
            isFreshGeneration,
            previousMetadata,
            wasSimplifiedOnSave,
            updateFromQueriesEnabled: options.updateFromQueriesEnabled === true,
        });

        await this.storage.saveSchema(metadata, workingJson);

        return {
            schema: workingSchema,
            schemaJson: workingJson,
            metadata,
            wasSimplifiedOnSave,
        };
    }

    // ── Telemetry helper ────────────────────────────────────────────────

    private reportSchemaTelemetry(args: {
        event: string;
        options: SchemaWriteOptions;
        metadata: SchemaMetadata;
        schemaJson: string;
        documentsInspectedInWrite: number;
        wasSimplifiedOnSave: boolean;
        cancelled?: boolean;
    }): void {
        const props = collectSchemaTelemetryProperties(args);

        if (args.options.actionContext) {
            Object.assign(args.options.actionContext.telemetry.properties, props.properties);
            Object.assign(args.options.actionContext.telemetry.measurements ?? {}, props.measurements);
            return;
        }

        void callWithTelemetryAndErrorHandling(args.event, (ctx) => {
            Object.assign(ctx.telemetry.properties, props.properties);
            Object.assign(ctx.telemetry.measurements, props.measurements);
        });
    }
}

// ─── Metadata composition ──────────────────────────────────────────────────

/**
 * Exported for unit testing — kept module-level (not a method on
 * {@link SchemaService}) because the calculation is pure and easier to cover
 * directly than through the full `mergeDocumentsIntoSchema` pipeline.
 */
export function composeMetadata(args: {
    schemaId: string;
    containerLabel: string;
    connection: NoSqlQueryConnection;
    sampleSize: number;
    isFreshGeneration: boolean;
    previousMetadata?: SchemaMetadata;
    wasSimplifiedOnSave: boolean;
    updateFromQueriesEnabled: boolean;
}): SchemaMetadata {
    const {
        schemaId,
        containerLabel,
        connection,
        sampleSize,
        isFreshGeneration,
        previousMetadata,
        wasSimplifiedOnSave,
        updateFromQueriesEnabled,
    } = args;

    const previousDocCount = previousMetadata ? parseInt(previousMetadata.documentCount, 10) || 0 : 0;
    const previousInitial = previousMetadata?.initialDocumentCount;
    const previousUpdatedFromQueries = previousMetadata?.updatedFromQueries === true;

    let documentCount: string;
    let initialDocumentCount: string | undefined;
    let updatedFromQueries: boolean;

    if (isFreshGeneration) {
        // Fresh manual generate: reset everything; treat sampleSize as the canonical count.
        documentCount = sampleSize.toString();
        initialDocumentCount = sampleSize.toString();
        updatedFromQueries = false;
    } else if (previousUpdatedFromQueries) {
        // Once the count has been frozen by a query-driven update it stays
        // frozen on every subsequent incremental write — *regardless* of
        // whether `updateFromQueriesEnabled` is currently on or off. Adding
        // post-freeze documents to a frozen pre-freeze sample size produces
        // a value that is neither a true "documents inspected" nor a true
        // running count.
        documentCount = previousDocCount.toString();
        initialDocumentCount = previousInitial ?? previousDocCount.toString();
        updatedFromQueries = true;
    } else if (updateFromQueriesEnabled) {
        // First query-driven incremental write: freeze the count from now on.
        documentCount = previousDocCount.toString();
        initialDocumentCount = previousInitial ?? previousDocCount.toString();
        updatedFromQueries = true;
    } else {
        // Non-query incremental write while the count is still trustworthy —
        // keep running it.
        documentCount = sampleSize.toString();
        initialDocumentCount = previousInitial ?? previousDocCount.toString();
        updatedFromQueries = false;
    }

    return {
        id: schemaId,
        name: containerLabel,
        generatedAt: new Date().toISOString(),
        documentCount,
        endpoint: connection.endpoint,
        databaseId: connection.databaseId,
        containerId: connection.containerId,
        initialDocumentCount,
        updatedFromQueries,
        wasSimplifiedOnSave: wasSimplifiedOnSave || previousMetadata?.wasSimplifiedOnSave === true,
    };
}

// ─── Telemetry property bag ────────────────────────────────────────────────

function collectSchemaTelemetryProperties(args: {
    options: SchemaWriteOptions;
    metadata: SchemaMetadata;
    schemaJson: string;
    documentsInspectedInWrite: number;
    wasSimplifiedOnSave: boolean;
    cancelled?: boolean;
}): { properties: Record<string, string>; measurements: Record<string, number> } {
    const { options, metadata, schemaJson, documentsInspectedInWrite, wasSimplifiedOnSave, cancelled } = args;

    const generateSchemaBasedOnQueriesEnabled = vscode.workspace
        .getConfiguration('cosmosDB.queryEditor')
        .get<boolean>('generateSchemaBasedOnQueries', false);

    const sizeBytes = Buffer.byteLength(schemaJson, 'utf8');
    const stats = inspectSchemaShape(JSON.parse(schemaJson) as JSONSchema);

    return {
        properties: {
            source: options.source,
            wasSimplifiedOnSave: String(wasSimplifiedOnSave),
            updatedFromQueries: String(metadata.updatedFromQueries === true),
            generateSchemaBasedOnQueriesEnabled: String(generateSchemaBasedOnQueriesEnabled),
            cancelled: String(cancelled === true),
        },
        measurements: {
            schemaSizeBytes: sizeBytes,
            documentsInspectedInWrite,
            effectiveDocumentCount: parseInt(metadata.documentCount, 10) || 0,
            initialDocumentCount: metadata.initialDocumentCount ? parseInt(metadata.initialDocumentCount, 10) || 0 : 0,
            topLevelPropertyCount: stats.topLevelPropertyCount,
            maxObservedDepth: stats.maxDepth,
            totalPropertyCount: stats.totalPropertyCount,
        },
    };
}

function inspectSchemaShape(schema: JSONSchema): {
    topLevelPropertyCount: number;
    maxDepth: number;
    totalPropertyCount: number;
} {
    let topLevelPropertyCount = 0;
    let maxDepth = 0;
    let totalPropertyCount = 0;

    const stack: Array<{ node: JSONSchema; depth: number }> = [{ node: schema, depth: 0 }];
    while (stack.length > 0) {
        const { node, depth } = stack.pop()!;
        if (depth > maxDepth) maxDepth = depth;

        if (node.properties) {
            const keys = Object.keys(node.properties);
            if (depth === 0) topLevelPropertyCount = keys.length;
            totalPropertyCount += keys.length;
            for (const key of keys) {
                const child = node.properties[key];
                if (child && typeof child === 'object') {
                    stack.push({ node: child, depth: depth + 1 });
                }
            }
        }

        if (node.anyOf) {
            for (const entry of node.anyOf) {
                if (entry && typeof entry === 'object') {
                    stack.push({ node: entry, depth });
                }
            }
        }

        if (node.items && typeof node.items === 'object' && !Array.isArray(node.items)) {
            stack.push({ node: node.items, depth: depth + 1 });
        }
    }

    return { topLevelPropertyCount, maxDepth, totalPropertyCount };
}

// ─── Aggressive simplification ─────────────────────────────────────────────

/**
 * Returns a deep-cloned, aggressively simplified copy of `schema`.
 *
 * The function is intentionally side-effect free so that it can be reused
 * both by {@link SchemaService.getSimplifiedSchema} (callers want the
 * smaller artifact) and by the in-service size guard (we want a smaller
 * persistent payload).
 */
export function aggressivelySimplify(
    schema: JSONSchema,
    options: Required<SimplifiedSchemaOptions>,
): { schema: JSONSchema; popularityKeyHit: boolean; wasSimplified: boolean } {
    const clone = deepCloneSchema(schema);
    let mutated = stripNoisyStats(clone);

    if (jsonByteSize(clone) <= options.targetSizeBytes) {
        return { schema: clone, popularityKeyHit: false, wasSimplified: mutated };
    }

    const popularityKeyHit = hasPopularityCounter(clone, options.popularityKey);

    if (popularityKeyHit) {
        const maxDepth = computeMaxDepth(clone);
        // Sweep deepest-first so each pass cuts the most localized noise first
        // and only escalates to wider cuts (closer to the root) when the
        // budget still isn't met.  Depth 0 is special: rather than apply a
        // fixed keepTopN there, we binary-search for the *largest* slice of
        // root entries that still fits the byte budget (see
        // `trimRootByPopularityAdaptive`).  This is what makes the simplified
        // schema actually approach the budget for wide-flat inputs instead
        // of being slashed far below it — `aggressivelySimplify` used to
        // either over-cut (output « budget) or be a near no-op (output »
        // budget) depending on the input shape.
        for (let depth = maxDepth; depth >= 1; depth--) {
            mutated = trimAtDepth(clone, depth, options.keepTopN, options.popularityKey) || mutated;
            if (jsonByteSize(clone) <= options.targetSizeBytes) {
                return { schema: clone, popularityKeyHit, wasSimplified: true };
            }
        }

        // Depth 0: adaptive root trim. `rootKeepTopN` is a *floor* — we never
        // cut the root below it, even if doing so means a slight budget
        // overflow.  This preserves the user-facing contract that the AI
        // always sees at least N stable top-level fields.
        mutated =
            trimRootByPopularityAdaptive(clone, options.rootKeepTopN, options.targetSizeBytes, options.popularityKey) ||
            mutated;
        if (jsonByteSize(clone) <= options.targetSizeBytes) {
            return { schema: clone, popularityKeyHit, wasSimplified: true };
        }
    }

    mutated = pruneBeyondDepth(clone, options.maxDepth) || mutated;

    return { schema: clone, popularityKeyHit, wasSimplified: mutated };
}

function deepCloneSchema(schema: JSONSchema): JSONSchema {
    // Schemas are tree-shaped JSON; structuredClone is the safest deep copy.
    return structuredClone(schema);
}

function jsonByteSize(value: unknown): number {
    return Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8');
}

function stripNoisyStats(node: JSONSchema | undefined): boolean {
    if (!node || typeof node !== 'object') return false;
    let mutated = false;

    for (const key of Object.keys(node)) {
        if (NOISY_STAT_KEYS.has(key)) {
            delete (node as Record<string, unknown>)[key];
            mutated = true;
        }
    }

    if (node.properties) {
        for (const child of Object.values(node.properties)) {
            if (typeof child === 'object') {
                mutated = stripNoisyStats(child) || mutated;
            }
        }
    }
    if (node.anyOf) {
        for (const entry of node.anyOf) {
            if (typeof entry === 'object') {
                mutated = stripNoisyStats(entry) || mutated;
            }
        }
    }
    if (node.items && typeof node.items === 'object' && !Array.isArray(node.items)) {
        mutated = stripNoisyStats(node.items) || mutated;
    }

    return mutated;
}

function hasPopularityCounter(node: JSONSchema | undefined, key: string): boolean {
    if (!node || typeof node !== 'object') return false;
    if (node.properties) {
        for (const child of Object.values(node.properties)) {
            if (child && typeof child === 'object') {
                if ((child as Record<string, unknown>)[key] !== undefined) return true;
                if (hasPopularityCounter(child, key)) return true;
            }
        }
    }
    if (node.anyOf) {
        for (const entry of node.anyOf) {
            if (typeof entry === 'object' && hasPopularityCounter(entry, key)) return true;
        }
    }
    if (node.items && typeof node.items === 'object' && !Array.isArray(node.items)) {
        return hasPopularityCounter(node.items, key);
    }
    return false;
}

function computeMaxDepth(schema: JSONSchema): number {
    let max = 0;
    const stack: Array<{ node: JSONSchema; depth: number }> = [{ node: schema, depth: 0 }];
    while (stack.length > 0) {
        const { node, depth } = stack.pop()!;
        if (depth > max) max = depth;
        if (node.properties) {
            for (const child of Object.values(node.properties)) {
                if (child && typeof child === 'object') {
                    stack.push({ node: child, depth: depth + 1 });
                }
            }
        }
        if (node.anyOf) {
            for (const entry of node.anyOf) {
                if (entry && typeof entry === 'object') {
                    stack.push({ node: entry, depth });
                }
            }
        }
        if (node.items && typeof node.items === 'object' && !Array.isArray(node.items)) {
            stack.push({ node: node.items, depth: depth + 1 });
        }
    }
    return max;
}

/**
 * Visits every container node at `targetDepth` and reduces its `properties`
 * to the top `keepTopN` by `popularityKey`. Returns `true` when at least one
 * deletion happened.
 *
 * Depth counts `properties` traversal: the root is depth 0; a node nested
 * under one `properties` map is depth 1; etc. `anyOf` does not increase
 * depth (it groups type alternatives of the same property), but `items`
 * does (an array element is structurally one level deeper).
 */
function trimAtDepth(schema: JSONSchema, targetDepth: number, keepTopN: number, popularityKey: string): boolean {
    let mutated = false;
    const stack: Array<{ node: JSONSchema; depth: number }> = [{ node: schema, depth: 0 }];

    while (stack.length > 0) {
        const { node, depth } = stack.pop()!;

        if (depth === targetDepth && node.properties) {
            mutated = trimChildrenByPopularity(node, keepTopN, popularityKey) || mutated;
        }

        if (node.properties) {
            for (const child of Object.values(node.properties)) {
                if (child && typeof child === 'object') {
                    stack.push({ node: child, depth: depth + 1 });
                }
            }
        }
        if (node.anyOf) {
            for (const entry of node.anyOf) {
                if (entry && typeof entry === 'object') {
                    stack.push({ node: entry, depth });
                }
            }
        }
        if (node.items && typeof node.items === 'object' && !Array.isArray(node.items)) {
            stack.push({ node: node.items, depth: depth + 1 });
        }
    }

    return mutated;
}

function trimChildrenByPopularity(node: JSONSchema, keepTopN: number, popularityKey: string): boolean {
    if (!node.properties) return false;

    const entries = Object.entries(node.properties)
        .map(([name, child]) => ({
            name,
            child,
            popularity:
                child && typeof child === 'object' ? Number((child as Record<string, unknown>)[popularityKey] ?? 0) : 0,
        }))
        .sort((a, b) => b.popularity - a.popularity);

    if (entries.length <= keepTopN) return false;

    const kept = new Set(entries.slice(0, keepTopN).map((e) => e.name));
    let mutated = false;
    for (const { name } of entries) {
        if (!kept.has(name)) {
            delete node.properties[name];
            mutated = true;
        }
    }
    return mutated;
}

/**
 * Trims the root `properties` bag by popularity, sizing the cut to the byte
 * budget.
 *
 * Unlike {@link trimChildrenByPopularity} (which takes a fixed `keepTopN`),
 * this performs a binary search over `k` ∈ `[minKeep, total]` and picks the
 * largest `k` whose schema serialisation still fits `targetSizeBytes`.
 *
 * Why only at the root?  Most schema bytes live in the root property bag
 * (especially for wide-flat schemas).  Adaptively choosing the cut here is
 * what lets the simplified schema actually approach the budget instead of
 * over-shooting or under-shooting it.  Deeper levels keep a fixed
 * `keepTopN` because they tend to be small and uniform — adaptive search
 * there would be expensive noise.
 *
 * `minKeep` is a hard floor.  When even keeping `minKeep` entries exceeds
 * the budget we still keep `minKeep` (slight overflow accepted) so that the
 * AI is never reduced to `{ id, partitionKey }`.
 */
function trimRootByPopularityAdaptive(
    schema: JSONSchema,
    minKeep: number,
    targetSizeBytes: number,
    popularityKey: string,
): boolean {
    if (!schema.properties) return false;

    const entries = Object.entries(schema.properties)
        .map(([name, child]) => ({
            name,
            child,
            popularity:
                child && typeof child === 'object' ? Number((child as Record<string, unknown>)[popularityKey] ?? 0) : 0,
        }))
        .sort((a, b) => b.popularity - a.popularity);

    const total = entries.length;
    if (total <= minKeep) {
        // Already at or below the floor — nothing to trim.
        return false;
    }

    const applyTop = (k: number): void => {
        const newProps: NonNullable<JSONSchema['properties']> = {};
        for (let i = 0; i < k; i++) {
            const e = entries[i];
            newProps[e.name] = e.child;
        }
        schema.properties = newProps;
    };

    // Binary search the largest k in [minKeep, total] that fits the budget.
    let lo = minKeep;
    let hi = total;
    let best = minKeep;

    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        applyTop(mid);
        if (jsonByteSize(schema) <= targetSizeBytes) {
            best = mid;
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }

    applyTop(best);
    return total > best;
}

function pruneBeyondDepth(schema: JSONSchema, maxDepth: number): boolean {
    let mutated = false;
    const stack: Array<{ node: JSONSchema; depth: number }> = [{ node: schema, depth: 0 }];

    while (stack.length > 0) {
        const { node, depth } = stack.pop()!;

        if (depth >= maxDepth && node.properties) {
            // Replace deeply nested properties bags with an empty object so the
            // structural placeholder is preserved without leaking the inner tree.
            const childKeys = Object.keys(node.properties);
            if (childKeys.length > 0) {
                node.properties = {};
                mutated = true;
            }
            continue;
        }

        if (node.properties) {
            for (const child of Object.values(node.properties)) {
                if (child && typeof child === 'object') {
                    stack.push({ node: child, depth: depth + 1 });
                }
            }
        }
        if (node.anyOf) {
            for (const entry of node.anyOf) {
                if (entry && typeof entry === 'object') {
                    stack.push({ node: entry, depth });
                }
            }
        }
        if (node.items && typeof node.items === 'object' && !Array.isArray(node.items)) {
            stack.push({ node: node.items, depth: depth + 1 });
        }
    }

    return mutated;
}
