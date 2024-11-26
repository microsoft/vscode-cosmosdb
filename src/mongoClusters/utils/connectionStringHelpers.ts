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

export const getUserNameFromConnectionString = (connectionString: string): string => {
    return new ConnectionString(connectionString).username;
};

export const getPasswordFromConnectionString = (connectionString: string): string => {
    return new ConnectionString(connectionString).password;
};

export const getHostsFromConnectionString = (connectionString: string): string[] => {
    return new ConnectionString(connectionString).hosts;
};

export const addDatabasePathToConnectionString = (connectionString: string, databaseName: string): string => {
    const connectionStringOb = new ConnectionString(connectionString);
    connectionStringOb.pathname = databaseName;
    return connectionStringOb.toString();
};

/**
 * Checks if any of the given hosts end with any of the provided suffixes.
 *
 * @param hosts - An array of host strings to check.
 * @param suffixes - An array of suffixes to check against the hosts.
 * @returns True if any host ends with any of the suffixes, false otherwise.
 */
function hostsEndWithAny(hosts: string[], suffixes: string[]): boolean {
    return hosts.some((host) => {
        const hostWithoutPort = host.split(':')[0].toLowerCase();
        return suffixes.some((suffix) => hostWithoutPort.endsWith(suffix));
    });
}

export function areMongoDBRU(hosts: string[]): boolean {
    const knownSuffixes = ['mongo.cosmos.azure.com'];
    return hostsEndWithAny(hosts, knownSuffixes);
}

export function areMongoDBvCore(hosts: string[]): boolean {
    const knownSuffixes = ['mongocluster.cosmos.azure.com'];
    return hostsEndWithAny(hosts, knownSuffixes);
}

export function areMongoDBAzure(hosts: string[]): boolean {
    const knownSuffixes = ['azure.com'];
    return hostsEndWithAny(hosts, knownSuffixes);
}
