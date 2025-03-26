/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import * as url from 'url';
import { ParsedConnectionString } from '../ParsedConnectionString';
import { nonNullProp } from '../utils/nonNull';

export function parseCosmosDBConnectionString(connectionString: string): ParsedCosmosDBConnectionString {
    const endpoint = getPropertyFromConnectionString(connectionString, 'AccountEndpoint');
    const masterKey = getPropertyFromConnectionString(connectionString, 'AccountKey');
    const databaseName = getPropertyFromConnectionString(connectionString, 'Database');

    if (!endpoint || !masterKey) {
        throw new Error(l10n.t('Invalid Cosmos DB connection string.'));
    }

    return new ParsedCosmosDBConnectionString(connectionString, endpoint, masterKey, databaseName);
}

function getPropertyFromConnectionString(connectionString: string, property: string): string | undefined {
    const regexp = new RegExp(`(?:^|;)\\s*${property}=([^;]+)(?:;|$)`, 'i');
    const match = connectionString.match(regexp);
    return match ? match[1] : undefined;
}

export class ParsedCosmosDBConnectionString extends ParsedConnectionString {
    public readonly hostName: string;
    public readonly port: string;

    public readonly documentEndpoint: string;
    public readonly masterKey: string;

    constructor(connectionString: string, endpoint: string, masterKey: string, databaseName: string | undefined) {
        super(connectionString, databaseName);
        this.documentEndpoint = endpoint;
        this.masterKey = masterKey;

        const parsedEndpoint = url.parse(endpoint);
        this.hostName = nonNullProp(parsedEndpoint, 'hostname', 'hostname');
        this.port = nonNullProp(parsedEndpoint, 'port', 'port');
    }
}
