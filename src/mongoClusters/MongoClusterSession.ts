/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type JSONSchema } from '../utils/json/JSONSchema';
import { MongoClustersClient } from './MongoClustersClient';

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

    private _jsonSchema: JSONSchema = {};
    private _currentQueryText: string = '';

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
        this._jsonSchema = {};

        this._currentQueryText = query.trim();
    }

    public async runQueryWithCache(databaseName: string, collectionName: string, query: string, pageNumber: number, pageSize: number) {
        this.resetCachesIfQueryChanged(query);

        const results = await this._client.runQuery(databaseName, collectionName, query, pageNumber, pageSize);

        // now, here we can do caching, data conversions, schema tracking and everything else we need to do
        // the client can be simplified and we can move some of the logic here, especially all data conversions

        return results;
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
