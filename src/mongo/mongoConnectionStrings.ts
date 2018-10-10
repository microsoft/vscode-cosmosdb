/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function parseConnectionString(connectionString: string): string[] | undefined {
    // Connection strings follow the following format (https://docs.mongodb.com/manual/reference/connection-string/):
    //   mongodb[+srv]://[username:password@]host1[:port1][,host2[:port2],...[,hostN[:portN]]][/[database][?options]]
    // Some example connection strings:
    //   mongodb://dbuser:dbpassword@dbname.mlab.com:14118
    //   mongodb+srv://db1.example.net:27017,db2.example.net:2500/?replicaSet=test
    //   mongodb://router1.example.com:27017,router2.example2.com:27017,router3.example3.com:27017/database?ssh=true
    // Regex splits into five parts:
    //   Full match
    //   mongodb[+srv]
    //   [username:password@]host1[:port1][,host2[:port2],...[,hostN[:portN]]]
    //   [database]
    //   [?options]

    try {
        let matches = connectionString.match('(^mongodb(?:[+]srv)?):\/\/([^\/]*)(?:\/([^/?]*)(.*))?$');
        if (matches && matches.length === 5) {
            return matches.map(str => {
                if (str === "") {
                    str = undefined;
                }
                return str;
            });
        }
    } catch (error) {
        // Shouldn't happen, but ignore if does
    }

    return undefined;
}

export function getDatabaseNameFromConnectionString(connectionString: string): string | undefined {
    try {
        let [, , , database] = parseConnectionString(connectionString);
        return database;
    } catch (error) {
        // Shouldn't happen, but ignore if does
    }

    return undefined;
}

export function getDatabaseConnectionStringByAccountConnectionString(connectionString: string, databaseName: string): string | undefined {
    try {
        let [, mongoPrefix, hosts, parsedDatabaseName, options] = parseConnectionString(connectionString);
        if (!parsedDatabaseName) {
            return mongoPrefix + String('://') + hosts + String('/') + databaseName + String('?') + options;
        } else {
            return connectionString;
        }
    } catch (error) {
        // Shouldn't happen, but ignore if does
    }

    return undefined;
}
