/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Client, ClientConfig } from 'pg';
import { Pool } from 'pg';
import { PoolClient } from 'pg';
import pgStructure from 'pg-structure';

import ProtocolCompletionItem from 'vscode-languageclient/lib/protocolCompletionItem';
import { Links } from '../constants';
import { ClientConfigClass } from './ClientConfigClass';
import { config } from './config';

// const { Pool } = require('pg-pool');

export async function connectToPostgresClient(): Promise<Client> {
    // appname appears to be the correct equivalent to user-agent for mongo
    // const options: MongoClientOptions = <MongoClientOptions>{
    //     // appName should be wrapped in '@'s when trying to connect to a Mongo account, this doesn't effect the appendUserAgent string
    //     appName: `@${appName}@`,
    //     // https://github.com/lmammino/mongo-uri-builder/issues/2
    //     useNewUrlParser: true
    // };

    // const clientConfig: ClientConfig = new ClientConfigClass(config);
    const client = new Client(config);
    // const pool = new Pool(config);

    try {
        return client;
    } catch (err) {
        const error = <{ message?: string, name?: string }>err;
        const name = error && error.name;
        const message = error && error.message;

        // Example error: "failed to connect to server [localhost:10255] on first connect [MongoError: connect ECONNREFUSED 127.0.0.1:10255]"
        // Example error: "failed to connect to server [127.0.0.1:27017] on first connect [MongoError: connect ECONNREFUSED 127.0.0.1:27017]"
        if (name === 'MongoError' && /ECONNREFUSED/.test(message) && /(localhost|127\.0\.0\.1)/.test(message)) {
            throw new Error(`Unable to connect to local Mongo DB instance. Make sure it is started correctly. See ${Links.LocalConnectionDebuggingTips} for tips.\n${message}`);
        }

        throw error;
    }
}
