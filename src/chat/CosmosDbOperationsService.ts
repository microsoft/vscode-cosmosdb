/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type JSONSchema } from '@cosmosdb/schema-analyzer';
import { getSchemaFromDocument, updateSchemaWithDocument, type NoSQLDocument } from '@cosmosdb/schema-analyzer/json';
import { type SerializedQueryResult } from '../cosmosdb/types/queryResult';
import { type QueryEditorTab } from '../panels/QueryEditorTab';
import { getConnectionFromQueryTab } from './chatUtils';

/**
 * Represents a single query execution with its results and inferred schema.
 * Groups query, results, and schema together for better LLM context.
 * Note: We do not include actual document data to avoid passing user PII to the LLM.
 */
export interface QueryExecutionEntry {
    /** The SQL query that was executed */
    query: string;
    /** Number of documents returned */
    documentCount: number;
    /** Request charge in RUs */
    requestCharge?: number;
    /** Inferred schema from the query results (structure only, no actual data) */
    schema?: JSONSchema;
    /** Pre-simplified schema from tool sampling (already in compact form) */
    simplifiedSchema?: Record<string, unknown>;
    /** Timestamp when the query was executed */
    timestamp?: number;
}

/**
 * Context containing grouped query history for LLM consumption.
 * Each entry groups a query with its results and schema.
 */
export interface QueryHistoryContext {
    /** Account ID (optional for backwards compatibility) */
    accountId?: string;
    /** Database being queried */
    databaseId: string;
    /** Container being queried */
    containerId: string;
    /** List of query executions with their grouped context */
    executions: QueryExecutionEntry[];
}

/**
 * Maximum number of query executions to store per container.
 */
const MAX_QUERY_HISTORY_PER_CONTAINER = 20;

export class CosmosDbOperationsService {
    private static instance: CosmosDbOperationsService;

    /**
     * In-memory storage for query execution history, keyed by "accountId/databaseId/containerId".
     * Each entry stores recent query executions with their computed schemas.
     */
    private queryHistoryStore: Map<string, QueryExecutionEntry[]> = new Map();

    /**
     * Generates a storage key for query history lookup.
     * @param accountId The account ID (optional)
     * @param databaseId The database ID
     * @param containerId The container ID
     * @returns A unique key in the format "accountId/databaseId/containerId"
     */
    private static getQueryHistoryKey(accountId: string | undefined, databaseId: string, containerId: string): string {
        return `${accountId ?? 'unknown'}/${databaseId}/${containerId}`;
    }

    public static getInstance(): CosmosDbOperationsService {
        if (!CosmosDbOperationsService.instance) {
            CosmosDbOperationsService.instance = new CosmosDbOperationsService();
        }
        return CosmosDbOperationsService.instance;
    }

    /**
     * Extracts schema from query results by analyzing all returned documents.
     */
    private extractSchemaFromResults(documents: unknown[]): JSONSchema | undefined {
        if (!documents || documents.length === 0) {
            return undefined;
        }

        try {
            const schema = getSchemaFromDocument(documents[0] as NoSQLDocument);
            for (const document of documents.slice(1)) {
                updateSchemaWithDocument(schema, document as NoSQLDocument);
            }
            return schema;
        } catch (error) {
            console.warn('Failed to extract schema from results:', error);
            return undefined;
        }
    }

    /**
     * Removes SQL comment lines (starting with --) from query text.
     * This cleans up the query before storing in history to avoid accumulating
     * nested "Previous query:" comments.
     */
    private static stripQueryComments(query: string): string {
        return query
            .split('\n')
            .filter((line) => !line.trim().startsWith('--'))
            .join('\n')
            .trim();
    }

    /**
     * Builds a query execution entry from a query result, grouping query, results, and schema together.
     */
    private buildQueryExecutionEntry(result: SerializedQueryResult): QueryExecutionEntry {
        const documents = result.documents || [];
        const schema = this.extractSchemaFromResults(documents);

        return {
            query: CosmosDbOperationsService.stripQueryComments(result.query),
            documentCount: documents.length,
            requestCharge: result.requestCharge,
            schema: schema,
            // Note: We do not include actual documents to avoid passing user PII to the LLM
            timestamp: Date.now(),
        };
    }

    /**
     * Records a query execution result to the in-memory history store.
     * This should be called after every successful query execution.
     * @param accountId The account ID (optional)
     * @param databaseId The database ID
     * @param containerId The container ID
     * @param result The serialized query result
     */
    public recordQueryExecution(
        accountId: string | undefined,
        databaseId: string,
        containerId: string,
        result: SerializedQueryResult,
    ): void {
        const key = CosmosDbOperationsService.getQueryHistoryKey(accountId, databaseId, containerId);
        const entry = this.buildQueryExecutionEntry(result);

        let history = this.queryHistoryStore.get(key);
        if (!history) {
            history = [];
            this.queryHistoryStore.set(key, history);
        }

        // Remove duplicate queries (keep most recent)
        const existingIndex = history.findIndex((e) => e.query === entry.query);
        if (existingIndex !== -1) {
            history.splice(existingIndex, 1);
        }

        // Add to the beginning (most recent first)
        history.unshift(entry);

        // Trim to max size
        if (history.length > MAX_QUERY_HISTORY_PER_CONTAINER) {
            history.length = MAX_QUERY_HISTORY_PER_CONTAINER;
        }
    }

    /**
     * Gets the query execution history for a specific container from the in-memory store.
     * @param accountId The account ID (optional)
     * @param databaseId The database ID
     * @param containerId The container ID
     * @returns The query history context or undefined if no history exists
     */
    public getQueryHistoryForContainer(
        accountId: string | undefined,
        databaseId: string,
        containerId: string,
    ): QueryHistoryContext | undefined {
        const key = CosmosDbOperationsService.getQueryHistoryKey(accountId, databaseId, containerId);
        const executions = this.queryHistoryStore.get(key);

        if (!executions || executions.length === 0) {
            return undefined;
        }

        return {
            accountId,
            databaseId,
            containerId,
            executions,
        };
    }

    /**
     * Gets the query history context from the active query editor.
     * Uses the in-memory query history store for better performance and consistency.
     */
    public getQueryHistoryContext(activeEditor: QueryEditorTab): QueryHistoryContext | undefined {
        const connection = getConnectionFromQueryTab(activeEditor);
        if (!connection) {
            return undefined;
        }

        // Use the in-memory store instead of iterating through sessions
        return this.getQueryHistoryForContainer(
            connection?.azureMetadata?.accountId,
            connection.databaseId,
            connection.containerId,
        );
    }
}
