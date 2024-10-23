/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import ConnectionString from 'mongodb-connection-string-url';

export const removePasswordFromConnectionString = (connectionString: string): string => {
    const connectionStringOb = new ConnectionString(connectionString);
    connectionStringOb.password = '';
    return connectionStringOb.toString();
};

export const addAuthenticationDataToConnectionString = (
    connectionString: string,
    username: string,
    password: string | undefined,
): string => {
    const connectionStringOb = new ConnectionString(connectionString);
    connectionStringOb.username = username;
    connectionStringOb.password = password ?? '';
    return connectionStringOb.toString();
};

export const addDatabasePathToConnectionString = (
    connectionString: string,
    databaseName: string
): string => {
    const connectionStringOb = new ConnectionString(connectionString);
    connectionStringOb.pathname = databaseName;
    return connectionStringOb.toString();
};
