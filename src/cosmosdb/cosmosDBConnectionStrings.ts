/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { ParsedConnectionString } from '../ParsedConnectionString';

export function parseCosmosDBConnectionString(connectionString: string): ParsedCosmosDBConnectionString {
    const endpoint = getPropertyFromConnectionString(connectionString, 'AccountEndpoint');
    const masterKey = getPropertyFromConnectionString(connectionString, 'AccountKey');
    const databaseName = getPropertyFromConnectionString(connectionString, 'Database');

    if (!endpoint) {
        throw new Error(l10n.t('Invalid Cosmos DB connection string.'));
    }

    const endpointUrl = new URL(endpoint);

    return new ParsedCosmosDBConnectionString(connectionString, endpointUrl, masterKey, databaseName);
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
    public readonly masterKey: string | undefined;

    constructor(
        connectionString: string,
        endpoint: URL,
        masterKey: string | undefined,
        databaseName: string | undefined,
    ) {
        super(connectionString, databaseName);

        this.hostName = endpoint.hostname;
        this.port = endpoint.port || '443';

        // Construct the endpoint URL with the port explicitly included
        // since URL.toString() does not include the port if it is the default (80 or 443)
        this.documentEndpoint = `${endpoint.protocol}//${this.hostName}:${this.port}${endpoint.pathname}${endpoint.search}`;
        this.masterKey = masterKey;
    }

    public get accountName(): string {
        // The hostname is in the format of "accountname.documents.azure.com"
        // Extract the first subdomain component by splitting the hostname on dots
        return this.hostName.split('.')[0];
    }
}
