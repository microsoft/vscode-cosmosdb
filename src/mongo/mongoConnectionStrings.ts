/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ReplSet } from "mongodb";
import { appendExtensionUserAgent } from "vscode-azureextensionui";
import { connectToMongoClient } from "./connectToMongoClient";

// Connection strings follow the following format (https://docs.mongodb.com/manual/reference/connection-string/):
//   mongodb[+srv]://[username:password@]host1[:port1][,host2[:port2],...[,hostN[:portN]]][/[database][?options]]
// Some example connection strings:
//   mongodb://dbuser:dbpassword@dbname.mlab.com:14118
//   mongodb+srv://db1.example.net:27017,db2.example.net:2500/?replicaSet=test
//   mongodb://router1.example.com:27017,router2.example2.com:27017,router3.example3.com:27017/database?ssh=true
// Regex splits into three parts:
//   Full match
//   mongodb[username:password@]host1[:port1][,host2[:port2],...[,hostN[:portN]]]
//   [database]

const parsePrefix = '([a-zA-Z]+:\/\/[^\/]*)';
const parseDatabaseName = '\/?([^/?]+)?';
const mongoConnectionStringRegExp = new RegExp(parsePrefix + parseDatabaseName);

export function getDatabaseNameFromConnectionString(connectionString: string): string | undefined {
    try {
        let [, , databaseName] = connectionString.match(mongoConnectionStringRegExp);
        return databaseName;
    } catch (error) {
        // Shouldn't happen, but ignore if does
    }

    return undefined;
}

export function addDatabaseToAccountConnectionString(connectionString: string, databaseName: string): string | undefined {
    try {
        return connectionString.replace(mongoConnectionStringRegExp, `$1\/${databaseName}`);
    } catch (error) {
        // Shouldn't happen, but ignore if does
    }

    return undefined;
}

export async function parseMongoConnectionString(connectionString: string): Promise<ParsedMongoConnectionString> {
    let host: string;
    let port: string;

    const db = await connectToMongoClient(connectionString, appendExtensionUserAgent());
    const serverConfig = db.serverConfig;
    // Azure CosmosDB comes back as a ReplSet
    if (serverConfig instanceof ReplSet) {
        // get the first connection string from the seedlist for the ReplSet
        // this may not be best solution, but the connection (below) gives
        // the replicaset host name, which is different than what is in the connection string
        // "s" is not part of ReplSet static definition but can't find any official documentation on it. Yet it is definitely there at runtime. Grandfathering in.
        // tslint:disable-next-line:no-any
        let rs: any = serverConfig;
        host = rs.s.replset.s.seedlist[0].host;
        port = rs.s.replset.s.seedlist[0].port;
    } else {
        host = serverConfig['host'];
        port = serverConfig['port'];
    }

    return new ParsedMongoConnectionString(connectionString, host, port, getDatabaseNameFromConnectionString(connectionString));
}

export class ParsedMongoConnectionString {
    public readonly host: string;
    public readonly port: string;

    /**
     * databaseName may be undefined if this is an account-level connection string
     */
    public readonly databaseName: string | undefined;
    public readonly connectionString: string;

    constructor(connectionString: string, host: string, port: string, databaseName: string | undefined) {
        this.connectionString = connectionString;
        this.host = host;
        this.port = port;
        this.databaseName = databaseName;
    }

    public get accountId(): string {
        return `${this.host}:${this.port}`;
    }

    public get fullId(): string {
        return `${this.accountId}${this.databaseName ? '/' + this.databaseName : ''}`;
    }
}
