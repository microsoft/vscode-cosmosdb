/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MongoClient, type MongoClientOptions } from 'mongodb';
import { emulatorPassword, Links } from '../constants';

export async function connectToMongoClient(connectionString: string, appName: string): Promise<MongoClient> {
    // appname appears to be the correct equivalent to user-agent for mongo
    const options: MongoClientOptions = <MongoClientOptions>{
        // appName should be wrapped in '@'s when trying to connect to a Mongo account, this doesn't effect the appendUserAgent string
        appName: `@${appName}@`,
        // https://github.com/lmammino/mongo-uri-builder/issues/2
        useNewUrlParser: true,
        useUnifiedTopology: true,
    };

    if (isCosmosEmulatorConnectionString(connectionString)) {
        // Prevents self signed certificate error for emulator https://github.com/microsoft/vscode-cosmosdb/issues/1241#issuecomment-614446198
        options.tlsAllowInvalidCertificates = true;
    }

    try {
        return await MongoClient.connect(connectionString, options);
    } catch (err) {
        // Note: This file can't use `parseError` from `@microsoft/vscode-azext-utils` because it's used by languageService.ts - see that file for more info
        const error = <{ message?: string; name?: string }>err;
        const message = error && error.message;

        // Example error: "failed to connect to server [localhost:10255] on first connect [MongoError: connect ECONNREFUSED 127.0.0.1:10255]"
        // Example error: "failed to connect to server [127.0.0.1:27017] on first connect [MongoError: connect ECONNREFUSED 127.0.0.1:27017]"
        if (message && /ECONNREFUSED/.test(message) && /(localhost|127\.0\.0\.1)/.test(message)) {
            throw new MongoConnectError();
        }

        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw error;
    }
}

export class MongoConnectError extends Error {
    constructor() {
        super(
            `Unable to connect to local Mongo DB instance. Make sure it is started correctly. See ${Links.LocalConnectionDebuggingTips} for tips.`,
        );
    }
}

export function isCosmosEmulatorConnectionString(connectionString: string): boolean {
    return connectionString.includes(encodeURIComponent(emulatorPassword));
}
