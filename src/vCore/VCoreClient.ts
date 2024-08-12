/**
 * wrapper for mongodclient, with handling of supported operations, plus, as a workaround, access to the raw mongodbclient.
 * also, client-pool, that handles active connections, over time adds notificaitons on dropped conenctions etc.
 * singletone on a client with a getter from a connection pool..
 */

import { ListDatabasesResult, MongoClient } from 'mongodb';
import { CredentialsStore } from './CredentialsStore';

export interface vCoreDatabaseInfo {
    name?: string;
}

export interface vCoreCollectionInfo {
    name: string;
}

export class VCoreClient {
    // cache of active/existing clients
    static _clients: Map<string, VCoreClient> = new Map();

    private _mongoClient: MongoClient;

    /**
     * Use getClient instead of a constructor. Connections/Client are being cached and reused.
     */
    private constructor() {
        return;
    }

    private async initClient(clientId: string): Promise<void> {
        if (!CredentialsStore.hasConnectionString(clientId)) {
            throw new Error(`No credentials found for client with id ${clientId}`);
        }
        const cStringPassword = CredentialsStore.getConnectionString(clientId);

        this._mongoClient = await MongoClient.connect(cStringPassword as string);
    }

    public static async getClient(clientId: string): Promise<VCoreClient> {
        let client: VCoreClient;

        if (VCoreClient._clients.has(clientId)) {
            client = VCoreClient._clients.get(clientId) as VCoreClient;

            // if the client is already connected, it's a NOOP.
            await client._mongoClient.connect();
        } else {
            client = new VCoreClient();
            await client.initClient(clientId);
            VCoreClient._clients.set(clientId, client);
        }

        return client;
    }

    async listDatabases(): Promise<vCoreDatabaseInfo[]> {
        const rawDatabases: ListDatabasesResult = await this._mongoClient.db().admin().listDatabases();
        const databases: vCoreDatabaseInfo[] = rawDatabases.databases;

        return databases;
    }

    async listCollections(databaseName: string): Promise<vCoreCollectionInfo[]> {
        const rawCollections = await this._mongoClient.db(databaseName).listCollections().toArray();
        const collections: vCoreCollectionInfo[] = rawCollections.map((collection) => {
            return { name: collection.name };
        });

        return collections;
    }
}
