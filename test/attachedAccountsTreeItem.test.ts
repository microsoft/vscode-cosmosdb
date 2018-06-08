/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The module 'assert' provides assertion methods from node
import * as assert from 'assert';

import { AttachedAccountsTreeItem, MONGO_CONNECTION_EXPECTED } from '../src/tree/AttachedAccountsTreeItem';

function assertConnectionValid(connectionString: string, expected: string | undefined) {
    const actual = AttachedAccountsTreeItem.validateMongoConnectionString(connectionString);
    assert.equal(actual, expected);
}


suite(`attachedAccountsTreeItem`, () => {
    suite(`validateDocDBConnectionString`, () => {
        // Connection strings follow the following format (https://docs.mongodb.com/manual/reference/connection-string/):
        // mongodb[+srv]://[username:password@]host1[:port1][,host2[:port2],...[,hostN[:portN]]][/[database][?options]]

        test('allows "mongodb://"', () => assertConnectionValid(`mongodb://your-mongo.documents.azure.com:10255`, undefined));

        test('allows "mongodb+srv://"', () => assertConnectionValid(`mongodb+srv://usr:pwd@mongodb.net:27017`, undefined));

        test('rejects bad prefix', () => assertConnectionValid(`http://localhost/`, MONGO_CONNECTION_EXPECTED));

        test('rejects null', () => assertConnectionValid(null, MONGO_CONNECTION_EXPECTED));
    });
});

