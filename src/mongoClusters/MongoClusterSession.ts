/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Document, type WithId } from 'mongodb';
import { type JSONSchema } from '../utils/json/JSONSchema';
import { getPropertyNamesAtLevel, updateSchemaWithDocument } from '../utils/json/mongo/SchemaAnalyzer';
import { getDataAtPath } from '../utils/slickgrid/mongo/toSlickGridTable';
import { toSlickGridTree, type TreeData } from '../utils/slickgrid/mongo/toSlickGridTree';
import { MongoClustersClient } from './MongoClustersClient';

export type TableDataEntry = { 'x-objectid'?: string; [key: string]: unknown };

export interface TableData {
    path: string[];
    headers: string[];
    data: TableDataEntry[];
}

export class MongoClustersSession {
    // cache of active/existing sessions
    static _sessions: Map<string, MongoClustersSession> = new Map();

    /**
     * Private constructor to enforce the use of `initNewSession` for creating new sessions.
     * This ensures that sessions are properly initialized and managed.
     */
    private constructor(private _client: MongoClustersClient) {
        return;
    }

    public getClient(): MongoClustersClient {
        return this._client;
    }

    /**
     * Tracks the known JSON schema for the current query
     * and updates it with everything we see until the query text changes.
     */
    private _currentJsonSchema: JSONSchema = {};
    private _currentQueryText: string = '';
    private _currentRawDocuments: WithId<Document>[] = [];

    /**
     * This is a basic approach for now, we can improve this later.
     * It's important to react to an updated query and to invalidate local caches if the query has changed.
     * @param query
     * @returns
     */
    private resetCachesIfQueryChanged(query: string) {
        if (this._currentQueryText.localeCompare(query.trim(), undefined, { sensitivity: 'base' }) === 0) {
            return;
        }

        // the query text has changed, caches are now invalid and have to be purged
        this._currentJsonSchema = {};
        this._currentRawDocuments = [];

        this._currentQueryText = query.trim();
    }

    public async runQueryWithCache(
        databaseName: string,
        collectionName: string,
        query: string,
        pageNumber: number,
        pageSize: number,
    ) {
        this.resetCachesIfQueryChanged(query);

        const documents: WithId<Document>[] = await this._client.runQuery(
            databaseName,
            collectionName,
            query,
            (pageNumber - 1) * pageSize, // converting page number to amount of documents to skip
            pageSize,
        );

        // now, here we can do caching, data conversions, schema tracking and everything else we need to do
        // the client can be simplified and we can move some of the logic here, especially all data conversions
        this._currentRawDocuments = documents;

        // JSON Schema
        this._currentRawDocuments.map((doc) => updateSchemaWithDocument(this._currentJsonSchema, doc));

        return documents.length;
    }

    public getCurrentPageAsJson(): string[] {
        return this._currentRawDocuments.map((doc) => JSON.stringify(doc, null, 4));
    }

    public getCurrentPageAsTree(): TreeData[] {
        return toSlickGridTree(this._currentRawDocuments);
    }

    public getCurrentPageAsTable(path: string[]): TableData {
        const responsePack: TableData = {
            path: path,
            headers: getPropertyNamesAtLevel(this._currentJsonSchema, path),
            data: getDataAtPath(this._currentRawDocuments, path),
        };

        return responsePack;
    }

    /**
     * Initializes a new session for the MongoDB vCore cluster.
     *
     * @param credentialId - The ID of the credentials used to authenticate the MongoDB client.
     * @returns A promise that resolves to the session ID of the newly created session.
     *
     * @throws Will throw an error if the client cannot be obtained using the provided credential ID.
     */
    public static async initNewSession(credentialId: string): Promise<string> {
        const client = await MongoClustersClient.getClient(credentialId);

        const sessionId = Math.random().toString(16).substring(2, 15) + Math.random().toString(36).substring(2, 15);

        const session = new MongoClustersSession(client);

        MongoClustersSession._sessions.set(sessionId, session);

        return sessionId;
    }

    /**
     * Retrieves a MongoClustersSession by its session ID.
     *
     * @param sessionId - The unique identifier for the session.
     * @returns The MongoClustersSession associated with the given session ID, or undefined if no session exists.
     *
     * @remarks
     * Sessions must be created using the `initNewSession` function before they can be retrieved with this method.
     */
    public static getSession(sessionId: string): MongoClustersSession {
        const session = this._sessions.get(sessionId);
        if (session === undefined) {
            throw new Error(`No session found for id ${sessionId}`);
        }

        return session;
    }

    public static closeSession(sessionId: string) {
        if (!this._sessions.has(sessionId)) {
            return;
        }

        this._sessions.delete(sessionId);
    }
}
