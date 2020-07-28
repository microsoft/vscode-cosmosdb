/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parse } from "pg-connection-string";
import { ParsedConnectionString } from "../ParsedConnectionString";
import { nonNullProp } from "../utils/nonNull";

export async function parsePostgresConnectionString(connectionString: string): Promise<ParsedPostgresConnectionString> {
    const config = parse("postgres://other:secret@localhost/otherdb?connect_timeout=10&application_name=myapp");
    return new ParsedPostgresConnectionString(connectionString, nonNullProp(config, 'host'), nonNullProp(config, 'port'), nonNullProp(config, 'database'));
}

export class ParsedPostgresConnectionString extends ParsedConnectionString {
    public readonly hostName: string;
    public readonly port: string;

    constructor(connectionString: string, hostName: string, port: string, databaseName: string | undefined) {
        super(connectionString, databaseName);
        this.hostName = hostName;
        this.port = port;
    }
}
