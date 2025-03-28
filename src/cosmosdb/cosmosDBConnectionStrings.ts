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
    public readonly masterKey: string | undefined;

    constructor(
        connectionString: string,
        endpoint: string,
        masterKey: string | undefined,
        databaseName: string | undefined,
    ) {
        super(connectionString, databaseName);
        this.documentEndpoint = endpoint;
        this.masterKey = masterKey;

        const parsedEndpoint = new URL(endpoint);
        this.hostName = parsedEndpoint.hostname;
        this.port = parsedEndpoint.port || '443';
    }

    public get accountName(): string {
        return this.hostName.replace('.documents.azure.com', '');
    }
}
