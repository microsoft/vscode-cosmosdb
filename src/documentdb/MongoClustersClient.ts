/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * wrapper for mongodclient, with handling of supported operations, plus, as a workaround, access to the raw mongodbclient.
 * also, client-pool, that handles active connections, over time adds notificaitons on dropped conenctions etc.
 * singletone on a client with a getter from a connection pool..
 */

import { appendExtensionUserAgent, callWithTelemetryAndErrorHandling, parseError } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { EJSON } from 'bson';
import {
    MongoClient,
    ObjectId,
    type Collection,
    type DeleteResult,
    type Document,
    type Filter,
    type FindOptions,
    type ListDatabasesResult,
    type MongoClientOptions,
    type WithId,
    type WithoutId,
} from 'mongodb';
import { Links } from '../constants';
import { type MongoEmulatorConfiguration } from '../utils/mongoEmulatorConfiguration';
import { CredentialCache } from './CredentialCache';
import { getHostsFromConnectionString, hasAzureDomain } from './utils/connectionStringHelpers';
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
    private emulatorConfiguration?: MongoEmulatorConfiguration;

    /**
     * Use getClient instead of a constructor. Connections/Client are being cached and reused.
     */
    private constructor(private readonly credentialId: string) {
        return;
    }

    // TODO: add support for single databases via connection string.
    //
    // const databaseInConnectionString = getDatabaseNameFromConnectionString(this.account.connectionString);
    // if (databaseInConnectionString && !this.isEmulator) {
    //     // emulator violates the connection string format
    //     // If the database is in the connection string, that's all we connect to (we might not even have permissions to list databases)
    //     databases = [
    //         {
    //             name: databaseInConnectionString,
    //             empty: false,
    //         },
    //     ];
    // }
    //
    // } catch (error) {
    //     const message = parseError(error).message;
    //     if (this.isEmulator && message.includes('ECONNREFUSED')) {
    //         // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    //         error.message = `Unable to reach emulator. See ${Links.LocalConnectionDebuggingTips} for debugging tips.\n${message}`;
    //     }
    //     throw error;
    // } finally {
    //     if (mongoClient) {
    //         void mongoClient.close();
    //     }
    // }

    private async initClient(): Promise<void> {
        // TODO: why is this a separate function? move its contents to the constructor.

        if (!CredentialCache.hasCredentials(this.credentialId)) {
            throw new Error(l10n.t('No credentials found for id {credentialId}', { credentialId: this.credentialId }));
        }

        const cString = CredentialCache.getCredentials(this.credentialId)?.connectionString as string;
        const hosts = getHostsFromConnectionString(cString);
        const userAgentString = hasAzureDomain(...hosts) ? appendExtensionUserAgent() : undefined;

        const cStringPassword = CredentialCache.getConnectionStringWithPassword(this.credentialId);
        this.emulatorConfiguration = CredentialCache.getEmulatorConfiguration(this.credentialId);

        // Prepare the options object and prepare the appName
        // appname appears to be the correct equivalent to user-agent for mongo
        const mongoClientOptions = <MongoClientOptions>{
            // appName should be wrapped in '@'s when trying to connect to a Mongo account, this doesn't effect the appendUserAgent string
            appName: userAgentString,
        };

        if (this.emulatorConfiguration?.isEmulator) {
            mongoClientOptions.serverSelectionTimeoutMS = 4000;

            if (this.emulatorConfiguration?.disableEmulatorSecurity) {
                // Prevents self signed certificate error for emulator https://github.com/microsoft/vscode-cosmosdb/issues/1241#issuecomment-614446198
                mongoClientOptions.tlsAllowInvalidCertificates = true;
            }
        }

        try {
            this._mongoClient = await MongoClient.connect(cStringPassword as string, mongoClientOptions);
        } catch (error) {
            const message = parseError(error).message;
            if (this.emulatorConfiguration?.isEmulator && message.includes('ECONNREFUSED')) {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                error.message = l10n.t(
                    'Unable to connect to local Mongo DB emulator. Make sure it is started correctly. See {link} for tips.',
                    { link: Links.LocalConnectionDebuggingTips },
                );
            } else if (this.emulatorConfiguration?.isEmulator && message.includes('self-signed certificate')) {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                error.message = l10n.t(
                    "The local Mongo DB emulator is using a self-signed certificate. To connect to the emulator, you must import the emulator's TLS/SSL certificate. See {link} for tips.",
                    { link: Links.LocalConnectionDebuggingTips },
                );
            }
            throw error;
        }

        void callWithTelemetryAndErrorHandling('cosmosDB.mongoClusters.connect.getmetadata', async (context) => {
            const metadata: MongoClusterMetadata = await getMongoClusterMetadata(this._mongoClient, hosts);

            context.telemetry.properties = {
                ...context.telemetry.properties,
                ...metadata,
            };
        });
    }

    /**
     * Retrieves an instance of `MongoClustersClient` based on the provided `credentialId`.
     *
     * @param credentialId - A required string used to find the cached connection string to connect.
     * It is also used as a key to reuse existing clients.
     * @returns A promise that resolves to an instance of `MongoClustersClient`.
     */
    public static async getClient(credentialId: string): Promise<MongoClustersClient> {
        let client: MongoClustersClient;

        if (MongoClustersClient._clients.has(credentialId)) {
            client = MongoClustersClient._clients.get(credentialId) as MongoClustersClient;

            // if the client is already connected, it's a NOOP.
            await client._mongoClient.connect();
        } else {
            client = new MongoClustersClient(credentialId);
            await client.initClient();
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
        return CredentialCache.getCredentials(this.credentialId)?.connectionUser;
    }
    getConnectionString() {
        return CredentialCache.getCredentials(this.credentialId)?.connectionString;
    }

    getConnectionStringWithPassword() {
        return CredentialCache.getConnectionStringWithPassword(this.credentialId);
    }

    async listDatabases(): Promise<DatabaseItemModel[]> {
        const rawDatabases: ListDatabasesResult = await this._mongoClient.db().admin().listDatabases();
        const databases: DatabaseItemModel[] = rawDatabases.databases.filter(
            // Filter out the 'admin' database if it's empty
            (databaseInfo) => !(databaseInfo.name && databaseInfo.name.toLowerCase() === 'admin' && databaseInfo.empty),
        );

        /**
         * this code in the comment is from older mongo implementation in the extension, review and test whether it's still relevant for us:
         * const databaseInConnectionString = getDatabaseNameFromConnectionString(this.connectionString);
                             if (databaseInConnectionString && !this.root.isEmulator) {
                                 // emulator violates the connection string format
                                 // If the database is in the connection string, that's all we connect to (we might not even have permissions to list databases)
                                 databases = [
                                     {
                                         name: databaseInConnectionString,
                                         empty: false,
                                     },
                                 ];
                             } else {
                                 // https://mongodb.github.io/node-mongodb-native/3.1/api/index.html
                                 // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                                 const result: { databases: IDatabaseInfo[] } = await mongoClient
                                     .db(testDb)
                                     .admin()
                                     .listDatabases();
                                 databases = result.databases;
                             }
         */

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
                    throw new Error(l10n.t('Invalid document ID: {0}', id));
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

    async createCollection(databaseName: string, collectionName: string): Promise<Collection<Document>> {
        return this._mongoClient.db(databaseName).createCollection(collectionName);
    }

    async createDatabase(databaseName: string): Promise<void> {
        // TODO: add logging of failures to the telemetry somewhere in the call chain
        const newCollection = await this._mongoClient
            .db(databaseName)
            .createCollection('_dummy_collection_creation_forces_db_creation');
        await newCollection.drop({ writeConcern: { w: 'majority', wtimeoutMS: 5000 } });
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
