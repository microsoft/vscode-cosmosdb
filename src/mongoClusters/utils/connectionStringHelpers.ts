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
 * Checks if any of the given hosts end with the provided domain name suffix.
 *
 * @param hosts - An array of host strings to check.
 * @param tld - The domain suffix to check against the hosts.
 * @returns True if any host ends with the suffix, false otherwise.
 */
export function hasDomainSuffix(tld: string, ...hosts: string[]): boolean {
    return hosts.some((host) => {
        const hostWithoutPort = extractDomainFromHost(host);
        return hostWithoutPort.endsWith(tld);
    });
}

export function hasAzureDomain(...hosts: string[]): boolean {
    return hasDomainSuffix(AzureDomains.GeneralAzure, ...hosts);
}

export function extractDomainFromHost(host: string): string {
    return host.split(':')[0].toLowerCase();
}

export const AzureDomains = {
    RU: 'mongo.cosmos.azure.com',
    vCore: 'mongocluster.cosmos.azure.com',
    GeneralAzure: 'azure.com',
};
