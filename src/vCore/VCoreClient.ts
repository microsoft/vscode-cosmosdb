/**
 * wrapper for mongodclient, with handling of supported operations, plus, as a workaround, access to the raw mongodbclient.
 * also, client-pool, that handles active connections, over time adds notificaitons on dropped conenctions etc.
 * singletone on a client with a getter from a connection pool..
 */

import { MongoClient, type ListDatabasesResult } from 'mongodb';
import { CredentialsStore } from './CredentialsStore';


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
}
