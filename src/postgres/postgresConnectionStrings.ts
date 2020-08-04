/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ClientConfig } from "pg";
import { parse } from "pg-connection-string";
import { ParsedConnectionString } from "../ParsedConnectionString";
import { nonNullProp } from "../utils/nonNull";

export async function parsePostgresConnectionString(connectionString: string): Promise<ParsedPostgresConnectionString> {
    const config = parse(connectionString);
    return new ParsedPostgresConnectionString(connectionString, nonNullProp(config, 'host'), nonNullProp(config, 'port'), nonNullProp(config, 'database'), nonNullProp(config, 'user'), nonNullProp(config, 'password'));
}

export async function createPostgresConnectionString(clientConfig: ClientConfig): Promise<string> {

    const user: string = nonNullProp(clientConfig, 'user');
    const password: string = nonNullProp(clientConfig, 'password');
    const host: string = nonNullProp(clientConfig, 'host');
    const port: string = String(nonNullProp(clientConfig, 'port'));
    return `postgres://${user}:${password}@${host}:${port}/'${clientConfig.database}'`;

}

export class ParsedPostgresConnectionString extends ParsedConnectionString {
    public readonly hostName: string;
    public readonly port: string;
    public readonly username: string;
    public readonly password: string;
    public readonly connStringType: string = 'postgres';

    constructor(connectionString: string, hostName: string, port: string, databaseName: string | undefined, username: string, password: string) {
        super(connectionString, databaseName?.replace(/[']+/g, ''));
        this.hostName = hostName;
        this.port = port;
        this.username = username;
        this.password = password;
    }
}
