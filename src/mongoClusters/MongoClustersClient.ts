/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * wrapper for mongodclient, with handling of supported operations, plus, as a workaround, access to the raw mongodbclient.
 * also, client-pool, that handles active connections, over time adds notificaitons on dropped conenctions etc.
 * singletone on a client with a getter from a connection pool..
 */

import { appendExtensionUserAgent, callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
import { EJSON } from 'bson';
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
import { areMongoDBAzure, getHostsFromConnectionString } from './utils/connectionStringHelpers';
import { getMongoClusterMetadata, type MongoClusterMetadata } from './utils/getMongoClusterMetadata';
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

export class MongoClustersClient {
    // cache of active/existing clients
    static _clients: Map<string, MongoClustersClient> = new Map();

    private _mongoClient: MongoClient;
    private _credentialId: string;

    /**
     * Use getClient instead of a constructor. Connections/Client are being cached and reused.
     */
    private constructor() {
        return;
    }

    private async initClient(credentialId: string): Promise<void> {
        if (!CredentialCache.hasCredentials(credentialId)) {
            throw new Error(`No credentials found for id ${credentialId}`);
        }

        this._credentialId = credentialId;

        // check if it's an azure connection, and do some special handling
        const cString = CredentialCache.getCredentials(credentialId)?.connectionString as string;
        const hosts = getHostsFromConnectionString(cString);
        const userAgentString = areMongoDBAzure(hosts) ? appendExtensionUserAgent() : undefined;

        const cStringPassword = CredentialCache.getConnectionStringWithPassword(credentialId);

        this._mongoClient = await MongoClient.connect(cStringPassword as string, {
            appName: userAgentString,
        });

        void callWithTelemetryAndErrorHandling('cosmosDB.mongoClusters.connect.getmetadata', async (context) => {
            const metadata: MongoClusterMetadata = await getMongoClusterMetadata(this._mongoClient);

            context.telemetry.properties = {
                ...context.telemetry.properties,
                ...metadata,
            };
        });
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

    public static async deleteClient(credentialId: string): Promise<void> {
        if (MongoClustersClient._clients.has(credentialId)) {
            const client = MongoClustersClient._clients.get(credentialId) as MongoClustersClient;
            await client._mongoClient.close(true);
            MongoClustersClient._clients.delete(credentialId);
        }
    }

    getUserName() {
        return CredentialCache.getCredentials(this._credentialId)?.connectionUser;
    }
    getConnectionString() {
        return CredentialCache.getCredentials(this._credentialId)?.connectionString;
    }

    getConnectionStringWithPassword() {
        return CredentialCache.getConnectionStringWithPassword(this._credentialId);
    }

    async listDatabases(): Promise<DatabaseItemModel[]> {
        const rawDatabases: ListDatabasesResult = await this._mongoClient.db().admin().listDatabases();
        const databases: DatabaseItemModel[] = rawDatabases.databases.filter(
            // Filter out the 'admin' database if it's empty
            (databaseInfo) => !(databaseInfo.name && databaseInfo.name.toLowerCase() === 'admin' && databaseInfo.empty),
        );

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
                    console.debug('streamDocuments: Aborted by an abort signal.');
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

    // TODO: revisit, maybe we can work on BSON here for the documentIds, and the conversion from string etc.,
    // will remain in the MongoClusterSession class
    async deleteDocuments(databaseName: string, collectionName: string, documentIds: string[]): Promise<boolean> {
        // Convert input data to BSON types
        const parsedDocumentIds = documentIds.map((id) => {
            let parsedId;
            try {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                parsedId = EJSON.parse(id);
            } catch {
                if (ObjectId.isValid(id)) {
                    parsedId = new ObjectId(id);
                } else {
                    throw new Error(`Invalid document ID: ${id}`);
                }
            }
            // eslint-disable-next-line @typescript-eslint/no-unsafe-return
            return parsedId;
        });

        // Connect and execute
        const collection = this._mongoClient.db(databaseName).collection(collectionName);
        const deleteResult: DeleteResult = await collection.deleteMany({ _id: { $in: parsedDocumentIds } });

        return deleteResult.acknowledged;
    }

    async pointRead(databaseName: string, collectionName: string, documentId: string) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let parsedDocumentId: any;
        try {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            parsedDocumentId = EJSON.parse(documentId);
        } catch (error) {
            if (ObjectId.isValid(documentId)) {
                parsedDocumentId = new ObjectId(documentId);
            } else {
                throw error;
            }
        }

        // connect and execute
        const collection = this._mongoClient.db(databaseName).collection(collectionName);

        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const documentContent = await collection.findOne({ _id: parsedDocumentId });

        return documentContent;
    }

    // TODO: add a dedicated insert function. The original idea of keeping it in upsert was to avoid code duplication,
    // however it leads to issues with the upsert logic.
    async upsertDocument(
        databaseName: string,
        collectionName: string,
        documentId: string,
        document: Document,
    ): Promise<{ documentId: unknown; document: WithId<Document> | null }> {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
        let parsedId: any;

        if (documentId === '') {
            // TODO: do not rely in empty string, use null or undefined
            parsedId = new ObjectId();
        } else {
            try {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                parsedId = EJSON.parse(documentId);
            } catch {
                if (ObjectId.isValid(documentId)) {
                    parsedId = new ObjectId(documentId);
                }
            }
        }

        // connect and execute
        const collection = this._mongoClient.db(databaseName).collection(collectionName);

        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        delete document._id;

        const replaceResult = await collection.replaceOne(
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            { _id: parsedId },
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            document as WithoutId<Document>,
            { upsert: true },
        );

        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
        const newDocumentId = (replaceResult.upsertedId as any) ?? parsedId;

        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
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
        let newCollection;
        try {
            newCollection = await this._mongoClient.db(databaseName).createCollection(collectionName);
        } catch (_e) {
            console.error(_e); //todo: add to telemetry
            return false;
        }

        return newCollection !== undefined;
    }

    async createDatabase(databaseName: string): Promise<boolean> {
        try {
            const newCollection = await this._mongoClient
                .db(databaseName)
                .createCollection('_dummy_collection_creation_forces_db_creation');
            await newCollection.drop({ writeConcern: { w: 'majority', wtimeout: 5000 } });
        } catch (_e) {
            console.error(_e); //todo: add to telemetry
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
