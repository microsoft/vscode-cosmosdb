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

export function createPostgresConnectionString(host: string, username?: string | undefined, password?: string | undefined): ParsedPostgresConnectionString {
    let connectionString: string;
    if (username && password) {
        connectionString = `postgres://${username}:${password}@${host}:${postgresDefaultPort}`;
    } else {
        connectionString = `postgres://${host}:${postgresDefaultPort}`;
    }
    return parsePostgresConnectionString(connectionString);
}

export class ParsedPostgresConnectionString extends ParsedConnectionString {
    public readonly hostName: string;
    public readonly username: string | undefined;
    public readonly password: string | undefined;
    public readonly port: string;

    constructor(connectionString: string, config: ConnectionOptions) {
        super(connectionString, config.database?.replace(/^"(.*)"$/, '$1'));
        this.hostName = nonNullProp(config, 'host');
        this.port = config.port ? config.port : `${postgresDefaultPort}`;
        this.username = config.user;
        this.password = config.password;
    }
}
