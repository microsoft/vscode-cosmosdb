/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ConnectionOptions, parse } from "pg-connection-string";
import { postgresDefaultPort } from "../constants";
import { ParsedConnectionString } from "../ParsedConnectionString";
import { nonNullProp } from "../utils/nonNull";

export function parsePostgresConnectionString(connectionString: string): ParsedPostgresConnectionString {
    const config: ConnectionOptions = parse(connectionString.trim());
    return new ParsedPostgresConnectionString(connectionString, config);
}

export function createPostgresConnectionString(host: string, port: number = postgresDefaultPort, username?: string | undefined, password?: string | undefined): ParsedPostgresConnectionString {
    let connectionString: string = `postgres://`;
    if (username && password) {
        connectionString += `${username}:${password}@`;
    }
    connectionString += `${host}:${port}`;
    return parsePostgresConnectionString(connectionString);
}

export class ParsedPostgresConnectionString extends ParsedConnectionString {
    public readonly hostName: string;
    public username: string | undefined;
    public password: string | undefined;
    public readonly port: string;
    public readonly options: string;

    constructor(connectionString: string, config: ConnectionOptions) {
        super(connectionString, config.database ? config.database : undefined);
        this.hostName = nonNullProp(config, 'host');
        this.port = config.port ? config.port : `${postgresDefaultPort}`;
        this.username = nonNullProp(config, 'user');
        this.password = nonNullProp(config, 'password');
    }

    public getEncodedConnectionString(databaseName?: string): string {
        let connectionString: string = `postgres://`;
        if (this.username && this.password) {
            const encodedUsername = encodeURIComponent(this.username);
            const encodedPassword = encodeURIComponent(this.password);
            connectionString += `${encodedUsername}:${encodedPassword}@`;

        }
        connectionString += `${this.hostName}:${this.port}`;
        if (databaseName) {
            const encodeDatabaseName = encodeURIComponent(databaseName);
            connectionString += `/${encodeDatabaseName}`;
        }
        return connectionString;
    }

}
