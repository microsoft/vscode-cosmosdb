/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * wrapper for mongodclient, with handling of supported operations, plus, as a workaround, access to the raw mongodbclient.
 * also, client-pool, that handles active connections, over time adds notificaitons on dropped conenctions etc.
 * singletone on a client with a getter from a connection pool..
 */

import {
    MongoClient,
    ObjectId,
    type DeleteResult,
    type Document,
    type Filter,
    type FindOptions,
    type ListDatabasesResult,
    type WithId,
    type WithoutId,
} from 'mongodb';
import { CredentialCache } from './CredentialCache';
import { toFilterQueryObj } from './utils/toFilterQuery';

export interface DatabaseItemModel {
    name: string;
    sizeOnDisk?: number;
    empty?: boolean;
}

export interface CollectionItemModel {
    name: string;
    type?: string;
    info?: {
        readOnly?: false;
    };
}

export interface IndexItemModel {
    name: string;
    key: {
        [key: string]: number | string;
    };
    version?: number;
}

export type InsertDocumentsResult = {
    /** Indicates whether this write result was acknowledged. If not, then all other members of this result will be undefined */
    acknowledged: boolean;
    /** The number of inserted documents for this operations */
    insertedCount: number;
};

// type TableColumnDef = { id: string; name: string; field: string; minWidth: number };

export class MongoClustersClient {
    // cache of active/existing clients
    static _clients: Map<string, MongoClustersClient> = new Map();

    private _mongoClient: MongoClient;

    /**
     * Use getClient instead of a constructor. Connections/Client are being cached and reused.
     */
    private constructor() {
        return;
    }

    private async initClient(credentialId: string): Promise<void> {
        if (!CredentialCache.hasConnectionString(credentialId)) {
            throw new Error(`No credentials found for id ${credentialId}`);
        }
        const cStringPassword = CredentialCache.getConnectionString(credentialId);

        this._mongoClient = await MongoClient.connect(cStringPassword as string);
    }

    public static async getClient(credentialId: string): Promise<MongoClustersClient> {
        let client: MongoClustersClient;

        if (MongoClustersClient._clients.has(credentialId)) {
            client = MongoClustersClient._clients.get(credentialId) as MongoClustersClient;

            // if the client is already connected, it's a NOOP.
            await client._mongoClient.connect();
        } else {
            client = new MongoClustersClient();
            await client.initClient(credentialId);
            MongoClustersClient._clients.set(credentialId, client);
        }

        return client;
    }

    async listDatabases(): Promise<DatabaseItemModel[]> {
        const rawDatabases: ListDatabasesResult = await this._mongoClient.db().admin().listDatabases();
        const databases: DatabaseItemModel[] = rawDatabases.databases;

        return databases;
    }

    async listCollections(databaseName: string): Promise<CollectionItemModel[]> {
        const rawCollections = await this._mongoClient.db(databaseName).listCollections().toArray();
        const collections: CollectionItemModel[] = rawCollections;

        return collections;
    }

    async listIndexes(databaseName: string, collectionName: string): Promise<IndexItemModel[]> {
        const collection = this._mongoClient.db(databaseName).collection(collectionName);
        const indexes = await collection.indexes();

        let i = 0; // backup for indexes with no names
        return indexes.map((index) => {
            return { name: index.name ?? 'idx_' + (i++).toString(), key: index.key, version: index.v };
        });
    }

    //todo: this is just a to see how it could work, we need to use a cursor here for paging
    async runQuery(
        databaseName: string,
        collectionName: string,
        findQuery: string,
        skip: number,
        limit: number,
    ): Promise<WithId<Document>[]> {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        if (findQuery === undefined || findQuery.trim().length === 0) {
            findQuery = '{}';
        }

        const findQueryObj: Filter<Document> = toFilterQueryObj(findQuery);

        const options: FindOptions = {
            skip: skip,
            limit: limit,
        };

        const collection = this._mongoClient.db(databaseName).collection(collectionName);
        const documents = await collection.find(findQueryObj, options).toArray();

        //TODO: add the FindCursor to the return type for paging

        return documents;
    }

    async *streamDocuments(
        databaseName: string,
        collectionName: string,
        abortSignal: AbortSignal,
        findQuery: string = '{}',
        skip: number = 0,
        limit: number = 0,
    ): AsyncGenerator<Document, void, unknown> {
        /**
         * Configuration
         */

        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        if (findQuery === undefined || findQuery.trim().length === 0) {
            findQuery = '{}';
        }

        const findQueryObj: Filter<Document> = toFilterQueryObj(findQuery);

        const options: FindOptions = {
            skip: skip > 0 ? skip : undefined,
            limit: limit > 0 ? limit : undefined,
        };

        const collection = this._mongoClient.db(databaseName).collection(collectionName);

        /**
         * Streaming
         */

        const cursor = collection.find(findQueryObj, options).batchSize(100);

        try {
            while (await cursor.hasNext()) {
                if (abortSignal.aborted) {
                    console.log('streamDocuments: Aborted by an abort signal.');
                    return;
                }

                // Fetch the next document and yield it to the consumer
                const doc = await cursor.next();
                if (doc !== null) {
                    yield doc;
                }
            }
        } finally {
            // Ensure the cursor is properly closed when done
            await cursor.close();
        }
    }

    async deleteDocuments(databaseName: string, collectionName: string, documentObjectIds: string[]): Promise<boolean> {
        // convert input data
        const objectIds = documentObjectIds.map((id) => new ObjectId(id));

        // connect and extecute
        const collection = this._mongoClient.db(databaseName).collection(collectionName);
        const deleteResult: DeleteResult = await collection.deleteMany({ _id: { $in: objectIds } });

        return deleteResult.acknowledged;
    }

    async pointRead(databaseName: string, collectionName: string, documentId: string) {
        const objectId = new ObjectId(documentId);

        // connect and execute
        const collection = this._mongoClient.db(databaseName).collection(collectionName);
        const documentContent = await collection.findOne({ _id: objectId });

        return documentContent;
    }

    async upsertDocument(
        databaseName: string,
        collectionName: string,
        documentId: string,
        document: Document,
    ): Promise<{ documentId: ObjectId; document: WithId<Document> | null }> {
        const objectId = documentId !== '' ? new ObjectId(documentId) : new ObjectId();

        // connect and execute
        const collection = this._mongoClient.db(databaseName).collection(collectionName);

        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        delete document._id;

        const replaceResult = await collection.replaceOne(
            { _id: objectId },
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            document as WithoutId<Document>,
            { upsert: true },
        );

        const newDocumentId = (replaceResult.upsertedId as ObjectId) ?? objectId;

        const newDocument = await collection.findOne({ _id: newDocumentId });

        return { documentId: newDocumentId, document: newDocument };
    }

    async dropCollection(databaseName: string, collectionName: string): Promise<boolean> {
        return this._mongoClient.db(databaseName).collection(collectionName).drop();
    }

    async dropDatabase(databaseName: string): Promise<boolean> {
        return this._mongoClient.db(databaseName).dropDatabase();
    }

    async createCollection(databaseName: string, collectionName: string): Promise<boolean> {
        try {
            await this._mongoClient.db(databaseName).createCollection(collectionName);
        } catch (_e) {
            console.log(_e); //todo: add to telemetry
            return false;
        }

        return true;
    }

    async createDatabase(databaseName: string): Promise<boolean> {
        try {
            const newCollection = await this._mongoClient
                .db(databaseName)
                .createCollection('_dummy_collection_creation_forces_db_creation');
            await newCollection.drop();
        } catch (_e) {
            console.log(_e); //todo: add to telemetry
            return false;
        }

        return true;
    }

    async insertDocuments(
        databaseName: string,
        collectionName: string,
        documents: Document[],
    ): Promise<InsertDocumentsResult> {
        const collection = this._mongoClient.db(databaseName).collection(collectionName);

        const insertManyResults = await collection.insertMany(documents, { forceServerObjectId: true });

        return {
            acknowledged: insertManyResults.acknowledged,
            insertedCount: insertManyResults.insertedCount,
        };
    }
}
