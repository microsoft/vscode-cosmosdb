/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MongoClient, MongoClientOptions } from 'mongodb';
import { Links } from '../constants';

export async function connectToMongoClient(connectionString: string, dbAccountName: string): Promise<MongoClient> {
    // appname appears to be the correct equivalent to user-agent for mongo
    let options: MongoClientOptions = <MongoClientOptions>{
        appName: `@${dbAccountName}@`,
        // https://github.com/lmammino/mongo-uri-builder/issues/2
        useNewUrlParser: true
    };

    options.ssl = true;

    try {
        return await MongoClient.connect(connectionString, options);
    } catch (err) {
        let error = <{ message?: string, name?: string }>err;
        let name = error && error.name;
        let message = error && error.message;

        // Example error: "failed to connect to server [localhost:10255] on first connect [MongoError: connect ECONNREFUSED 127.0.0.1:10255]"
        // Example error: "failed to connect to server [127.0.0.1:27017] on first connect [MongoError: connect ECONNREFUSED 127.0.0.1:27017]"
        if (name === 'MongoError' && /ECONNREFUSED/.test(message) && /(localhost|127\.0\.0\.1)/.test(message)) {
            throw new Error(`Unable to connect to local Mongo DB instance. Make sure it is started correctly. See ${Links.LocalConnectionDebuggingTips} for tips.\n${message}`);
        }

        throw error;
    }
}
