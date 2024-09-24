/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AttachedAccountsTreeItem, MONGO_CONNECTION_EXPECTED } from './AttachedAccountsTreeItem';

describe(`attachedAccountsTreeItem`, () => {
    describe(`validateDocDBConnectionString`, () => {
        // Connection strings follow the following format (https://docs.mongodb.com/manual/reference/connection-string/):
        // mongodb[+srv]://[username:password@]host1[:port1][,host2[:port2],...[,hostN[:portN]]][/[database][?options]]

        it('allows "mongodb://"', () => {
            const actual = AttachedAccountsTreeItem.validateMongoConnectionString(
                `mongodb://your-mongo.documents.azure.com:10255`,
            );
            expect(actual).toEqual(undefined);
        });

        it('allows "mongodb+srv://"', () => {
            const actual = AttachedAccountsTreeItem.validateMongoConnectionString(
                `mongodb+srv://usr:pwd@mongodb.net:27017`,
            );
            expect(actual).toEqual(undefined);
        });

        it('rejects bad prefix', () => {
            const actual = AttachedAccountsTreeItem.validateMongoConnectionString(`http://localhost/`);
            expect(actual).toEqual(MONGO_CONNECTION_EXPECTED);
        });

        it('rejects null', () => {
            const actual = AttachedAccountsTreeItem.validateMongoConnectionString(null!);
            expect(actual).toEqual(MONGO_CONNECTION_EXPECTED);
        });
    });
});
