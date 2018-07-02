/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MongoClient, Db, MongoClientOptions } from 'mongodb';
import { appendExtensionUserAgent } from 'vscode-azureextensionui';

export async function connectToMongoClient(connectionString: string): Promise<Db> {
    let extensionUserAgent = appendExtensionUserAgent();

    // appname is missing in our version of types/mongodb, but we can't upgrade without upgrading the client, too
    let options: MongoClientOptions = <MongoClientOptions>{
        appname: extensionUserAgent
    };

    return await MongoClient.connect(connectionString, options);
}
