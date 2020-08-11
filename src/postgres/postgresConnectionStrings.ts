/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ConnectionOptions, parse } from "pg-connection-string";
import { ParsedConnectionString } from "../ParsedConnectionString";
import { nonNullProp } from "../utils/nonNull";

export async function parsePostgresConnectionString(connectionString: string): Promise<ParsedPostgresConnectionString> {
    connectionString = connectionString ? connectionString.trim() : '';
    let accountConnection: boolean = false;
    if (!connectionString.match(/^postgres:\/\/[^\/\s]+\/[^\/\s]+$/)) {
        if (connectionString.charAt(connectionString.length - 1) === "/") {
            connectionString = connectionString + "postgres";
        } else {
            connectionString = connectionString + "/postgres";
        }
        accountConnection = true;
    }
    const config: ConnectionOptions = parse(connectionString);
    return new ParsedPostgresConnectionString(connectionString, config, accountConnection);
}

export class ParsedPostgresConnectionString extends ParsedConnectionString {
    public readonly hostName: string;
    public readonly port: string;
    public readonly username: string;
    public readonly password: string;
    public readonly accountConnection: boolean;

    constructor(connectionString: string, config: ConnectionOptions, accountConnection: boolean) {
        super(connectionString, config.database?.replace(/[']+/g, ''));
        this.hostName = nonNullProp(config, 'host');
        this.port = nonNullProp(config, 'port');
        this.username = nonNullProp(config, 'user');
        this.password = nonNullProp(config, 'password');
        this.accountConnection = accountConnection;
    }
}
