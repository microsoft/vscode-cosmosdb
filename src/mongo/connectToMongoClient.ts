/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Db, MongoClient, MongoClientOptions } from 'mongodb';

// Can't call appendExtensionUserAgent() here because languageClient.ts can't take a dependency on vscode-azureextensionui and hence vscode, so have
//   to pass the user agent string in
export async function connectToMongoClient(connectionString: string, extensionUserAgent: string): Promise<Db> {
    // appname appears to be the correct equivalent to user-agent for mongo
    let options: MongoClientOptions = <MongoClientOptions>{
        appname: extensionUserAgent
    };

    return await MongoClient.connect(connectionString, options);
}
