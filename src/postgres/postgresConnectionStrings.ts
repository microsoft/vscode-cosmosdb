/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import  { type ConnectionOptions} from 'pg-connection-string';
import { parse } from 'pg-connection-string';
import { postgresDefaultPort } from '../constants';
import { ParsedConnectionString } from '../ParsedConnectionString';
import { nonNullProp } from '../utils/nonNull';

export function parsePostgresConnectionString(connectionString: string): ParsedPostgresConnectionString {
    const config: ConnectionOptions = parse(connectionString.trim());
    return new ParsedPostgresConnectionString(connectionString, config);
}

export function addDatabaseToConnectionString(connectionString: string, databaseName: string): string {
    const url = new URL(connectionString);
    url.pathname = encodeURIComponent(databaseName);
    return url.toString();
}

export function createPostgresConnectionString(
    hostName: string,
    port: string = postgresDefaultPort,
    username?: string | undefined,
    password?: string | undefined,
    databaseName?: string | undefined,
): string {
    let connectionString: string = `postgres://`;
    if (username) {
        const encodedUsername = encodeURIComponent(username);
        if (password) {
            const encodedPassword = encodeURIComponent(password);
            connectionString += `${encodedUsername}:${encodedPassword}@`;
        } else {
            connectionString += `${encodedUsername}@`;
        }
    }
    connectionString += `${hostName}:${port}`;
    if (databaseName) {
        const encodeDatabaseName = encodeURIComponent(databaseName);
        connectionString += `/${encodeDatabaseName}`;
    }
    return connectionString;
}

export function copyPostgresConnectionString(
    hostName: string,
    port: string = postgresDefaultPort,
    username?: string | undefined,
    password?: string | undefined,
    databaseName?: string | undefined,
): string {
    let connectionString: string = `postgres://`;
    if (username) {
        const encodedUsername = encodeURIComponent(username);
        if (password) {
            const encodedPassword = encodeURIComponent(password);
            const encodedPasswordWithQuotes = "'" + encodedPassword + "'";
            connectionString += `${encodedUsername}:${encodedPasswordWithQuotes}@`;
        } else {
            connectionString += `${encodedUsername}@`;
        }
    }
    connectionString += `${hostName}:${port}`;
    if (databaseName) {
        const encodeDatabaseName = encodeURIComponent(databaseName);
        connectionString += `/${encodeDatabaseName}`;
    }
    return connectionString;
}

export class ParsedPostgresConnectionString extends ParsedConnectionString {
    public readonly hostName: string;
    public username: string | undefined;
    public password: string | undefined;
    public readonly port: string;

    constructor(connectionString: string, config: ConnectionOptions) {
        super(connectionString, config.database ? config.database : undefined);
        this.hostName = nonNullProp(config, 'host');
        this.port = config.port ? config.port : `${postgresDefaultPort}`;
        this.username = config.user;
        this.password = config.password;
    }
}
