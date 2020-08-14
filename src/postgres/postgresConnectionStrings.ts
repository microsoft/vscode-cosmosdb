/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ConnectionOptions, parse } from "pg-connection-string";
import { postgresDefaultPort } from "../constants";
import { ParsedConnectionString } from "../ParsedConnectionString";
import { nonNullProp } from "../utils/nonNull";

export async function parsePostgresConnectionString(connectionString: string): Promise<ParsedPostgresConnectionString> {
    const config: ConnectionOptions = parse(connectionString.trim());
    return new ParsedPostgresConnectionString(connectionString, config);
}

export async function createPostgresConnectionString(host: string, username?: string | undefined, password?: string | undefined): Promise<ParsedPostgresConnectionString> {
    let connectionString: string;
    if (username && password) {
        connectionString = `postgres://${username}:${password}@${host}:${postgresDefaultPort}`;
    } else {
        connectionString = `postgres://${host}:${postgresDefaultPort}`;
    }
    return await parsePostgresConnectionString(connectionString);
}

export class ParsedPostgresConnectionString extends ParsedConnectionString {
    public readonly hostName: string;
    public readonly username: string;
    public readonly password: string;
    public readonly name: string;
    public readonly port: string;

    constructor(connectionString: string, config: ConnectionOptions) {
        super(connectionString, config.database?.replace(/[']+/g, ''));
        this.hostName = nonNullProp(config, 'host');
        this.port = config.port ? config.port : `${postgresDefaultPort}`;
        this.username = nonNullProp(config, 'user');
        this.password = nonNullProp(config, 'password');
        this.name = this.hostName.split(".")[0];
    }
}
