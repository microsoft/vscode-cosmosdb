/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Db, MongoClient, MongoClientOptions } from 'mongodb';
import { parseError } from 'vscode-azureextensionui';
import { Links } from '../constants';

// Can't call appendExtensionUserAgent() here because languageClient.ts can't take a dependency on vscode-azureextensionui and hence vscode, so have
//   to pass the user agent string in
export async function connectToMongoClient(connectionString: string, extensionUserAgent: string): Promise<Db> {
    // appname appears to be the correct equivalent to user-agent for mongo
    let options: MongoClientOptions = <MongoClientOptions>{
        appname: extensionUserAgent
    };

    try {
        return await MongoClient.connect(connectionString, options);
    } catch (error) {
        let message = parseError(error).message;
        // Example error: "failed to connect to server [localhost:10255] on first connect [MongoError: connect ECONNREFUSED 127.0.0.1:10255]"
        // Example error: "failed to connect to server [127.0.0.1:27017] on first connect [MongoError: connect ECONNREFUSED 127.0.0.1:27017]"
        if (/MongoError.*ECONNREFUSED*/.test(message) && /(localhost|127\.0\.0\.1)/.test(message)) {
            throw new Error(`Unable to connect to local Mongo DB instance. Make sure it is started correctly. See ${Links.LocalConnectionDebuggingTips} for tips.\n${message}`);
        }

        throw error;
    }
}
