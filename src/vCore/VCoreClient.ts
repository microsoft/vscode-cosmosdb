/**
 * wrapper for mongodclient, with handling of supported operations, plus, as a workaround, access to the raw mongodbclient.
 * also, client-pool, that handles active connections, over time adds notificaitons on dropped conenctions etc.
 * singletone on a client with a getter from a connection pool..
 */

import { MongoClient, type Document, type FindOptions, type ListDatabasesResult, type WithId } from 'mongodb';
import { CredentialsStore } from './CredentialsStore';
import { toSlickGridTree, type TreeData } from './utils/toSlickGridTree';

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

type TableColumnDef = { id: string; name: string; field: string; minWidth: number };

export interface QueryReponsePack {
    table?: object[];
    tableColumns?: TableColumnDef[];
    tree?: TreeData[];
    json?: string;
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
        //const findQueryObj = JSON.parse(findQuery) as Filter<Document>;

        const options: FindOptions = {
            skip: skip,
            limit: limit,
        };

        const collection = this._mongoClient.db(databaseName).collection(collectionName);
        const documents = await collection.find({}, options).toArray();

        // json
        const responsePack: QueryReponsePack = {
            json: JSON.stringify(documents, null, 4),
        };

        // table
        const topLevelKeys = this.allTopLevelKeys(documents);

        responsePack.tableColumns = topLevelKeys.map((key) => {
            return {
                id: key,
                name: key,
                field: key,
                minWidth: 100,
            };
        });

        responsePack.table = this.topLevelData(documents);

        responsePack.tree = toSlickGridTree(documents);

        return responsePack;
    }

    allTopLevelKeys(docs: WithId<Document>[]): string[] {
        const keys = new Set<string>();

        for (const doc of docs) {
            for (const key of Object.keys(doc)) {
                keys.add(key);
            }
        }

        return Array.from(keys);
    }

    topLevelData(docs: WithId<Document>[]): object[] {
        const result = new Array<object>();

        let i = 0;
        for (const doc of docs) {
            const row = { id: i };
            for (const key of Object.keys(doc)) {
                if (key === '_id') {
                    row[key] = doc[key].toString();
                } else {
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                    row[key] = `${doc[key]}`;
                }
            }

            i++;
            result.push(row);
        }

        return result;
    }
}
