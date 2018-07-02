/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MongoClient, Db, MongoClientOptions } from 'mongodb';
import { appendExtensionUserAgent } from 'vscode-azureextensionui';

export async function connectToMongoClient(connectionString: string): Promise<Db> {
    let extensionUserAgent = appendExtensionUserAgent();

    // appname appears to be the correct equivalent to user-agent for mongo
    let options: MongoClientOptions = <MongoClientOptions>{
        appname: extensionUserAgent,

    };

    return await MongoClient.connect(connectionString, options);
}
