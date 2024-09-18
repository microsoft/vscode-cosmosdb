/**
 * wrapper for mongodclient, with handling of supported operations, plus, as a workaround, access to the raw mongodbclient.
 * also, client-pool, that handles active connections, over time adds notificaitons on dropped conenctions etc.
 * singletone on a client with a getter from a connection pool..
 */

import { MongoClient, type Filter, type FindOptions, type ListDatabasesResult } from 'mongodb';
import { getDataTopLevel, getFieldsTopLevel } from '../utils/slickgrid/mongo/toSlickGridTable';
import { toSlickGridTree, type TreeData } from '../utils/slickgrid/mongo/toSlickGridTree';
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

// type TableColumnDef = { id: string; name: string; field: string; minWidth: number };

export interface QueryReponsePack {
    tableHeaders?: string[];
    tableData?: object[];

    treeData?: TreeData[];

    json?: string;
}

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
    async queryDocuments(
        databaseName: string,
        collectionName: string,
        findQuery: string,
        skip: number,
        limit: number,
    ): Promise<QueryReponsePack> {
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

        // json
        const responsePack: QueryReponsePack = {
            json: JSON.stringify(documents, null, 4),
        };

        // table
        responsePack.tableHeaders = getFieldsTopLevel(documents);
        responsePack.tableData = getDataTopLevel(documents);

        responsePack.treeData = toSlickGridTree(documents);

        return responsePack;
    }
}
