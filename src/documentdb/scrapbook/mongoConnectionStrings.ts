/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { appendExtensionUserAgent, parseError, type IParsedError } from '@microsoft/vscode-azext-utils';
import { type MongoClient } from 'mongodb';
import { ParsedConnectionString } from '../../ParsedConnectionString';
import { nonNullValue } from '../../utils/nonNull';
import { connectToClient } from './connectToClient';

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

const parsePrefix = '([a-zA-Z]+://[^/]*)';
const parseDatabaseName = '/?([^/?]+)?';
const mongoConnectionStringRegExp = new RegExp(parsePrefix + parseDatabaseName);

export function getDatabaseNameFromConnectionString(connectionString: string): string | undefined {
    try {
        const [, , databaseName] = nonNullValue(
            connectionString.match(mongoConnectionStringRegExp),
            'databaseNameMatch',
        );
        return databaseName;
    } catch {
        // Shouldn't happen, but ignore if does
    }

    return undefined;
}

export function addDatabaseToAccountConnectionString(connectionString: string, databaseName: string): string {
    try {
        return connectionString.replace(mongoConnectionStringRegExp, `$1/${encodeURIComponent(databaseName)}`);
    } catch {
        // Shouldn't happen, but ignore if does. Original connection string could be in a format we don't expect, but might already have the db name or might still work without it
        return connectionString;
    }
}

export async function parseMongoConnectionString(connectionString: string): Promise<ParsedMongoConnectionString> {
    let mongoClient: MongoClient;
    try {
        mongoClient = await connectToClient(connectionString, appendExtensionUserAgent());
    } catch (error) {
        const parsedError: IParsedError = parseError(error);
        if (parsedError.message.match(/unescaped/i)) {
            // Prevents https://github.com/microsoft/vscode-cosmosdb/issues/1209
            connectionString = encodeMongoConnectionString(connectionString);
            mongoClient = await connectToClient(connectionString, appendExtensionUserAgent());
        } else {
            throw error;
        }
    }

    const { host, port } = mongoClient.options.hosts[0];

    return new ParsedMongoConnectionString(
        connectionString,
        host as string,
        (port as number).toString(),
        getDatabaseNameFromConnectionString(connectionString),
    );
}

export class ParsedMongoConnectionString extends ParsedConnectionString {
    public readonly hostName: string;
    public readonly port: string;

    constructor(connectionString: string, hostName: string, port: string, databaseName: string | undefined) {
        super(connectionString, databaseName);
        this.hostName = hostName;
        this.port = port;
    }
}

/**
 * Encodes the username and password in the given Mongo DB connection string.
 */
export function encodeMongoConnectionString(connectionString: string): string {
    const matches: RegExpMatchArray | null = connectionString.match(/^(.*):\/\/(.*):(.*)@(.*)/);
    if (matches) {
        const prefix: string = matches[1];
        const username: string = matches[2];
        const password: string = matches[3];
        const hostAndQuery: string = matches[4];
        connectionString = `${prefix}://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${hostAndQuery}`;
    }

    return connectionString;
}
