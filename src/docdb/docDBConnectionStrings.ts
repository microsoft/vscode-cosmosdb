/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as url from 'url';
import { ParsedConnectionString } from '../ParsedConnectionString';

export function parseDocDBConnectionString(connectionString: string): ParsedDocDBConnectionString {
    const endpoint = getPropertyFromConnectionString(connectionString, 'AccountEndpoint');
    const masterKey = getPropertyFromConnectionString(connectionString, 'AccountKey');
    const databaseName = getPropertyFromConnectionString(connectionString, 'Database');
    if (!endpoint || !masterKey || connectionString.match(" ")) {
        throw new Error('Invalid Document DB connection string.');
    }
    return new ParsedDocDBConnectionString(connectionString, endpoint, masterKey, databaseName);
}

function getPropertyFromConnectionString(connectionString: string, property: string): string | undefined {
    const regexp = new RegExp(`(?:^|;)\\s*${property}=([^;]+)(?:;|$)`, 'i');
    const match = connectionString.match(regexp);
    return match && match[1];
}

export class ParsedDocDBConnectionString extends ParsedConnectionString {
    public readonly hostName: string;
    public readonly port: string;

    public readonly documentEndpoint: string;
    public readonly masterKey: string;

    constructor(connectionString: string, endpoint: string, masterKey: string, databaseName: string | undefined) {
        super(connectionString, databaseName);
        this.documentEndpoint = endpoint;
        this.masterKey = masterKey;

        const parsedEndpoint = url.parse(endpoint);
        this.hostName = parsedEndpoint.hostname;
        this.port = parsedEndpoint.port;
    }
}
