/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Client } from 'pg';

export async function connectToPostgresClient(clientConfig): Promise<Client> {

    const client = new Client(clientConfig);
    console.log(clientConfig.database);
    try {
        return client;
    } catch (err) {
        const error = <{ message?: string, name?: string }>err;
        throw error;
    }
}
