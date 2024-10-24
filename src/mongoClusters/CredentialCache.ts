/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { addAuthenticationDataToConnectionString } from './utils/connectionStringHelpers';

export interface MongoClustersCredentials {
    credentialId: string;
    connectionStringWithPassword?: string; // wipe it after use
    connectionString: string;
    connectionUser: string;
}

export class CredentialCache {
    // clientId -> mongoClusters credentials
    private static _store: Map<string, MongoClustersCredentials> = new Map();

    public static getConnectionStringWithPassword(credentialId: string): string {
        return CredentialCache._store.get(credentialId)?.connectionStringWithPassword as string;
    }

    public static hasCredentials(credentialId: string): boolean {
        return CredentialCache._store.has(credentialId) as boolean;
    }

    public static getCredentials(credentialId: string): MongoClustersCredentials | undefined {
        return CredentialCache._store.get(credentialId);
    }

    /**
     *
     * @param connectionString connection string with credentials
     */
    /**
     * Sets the credentials for a given connection string and stores them in the credential cache.
     *
     * @param connectionString - The connection string to which the credentials will be added.
     * @param username - The username to be used for authentication.
     * @param password - The password to be used for authentication.
     * @returns A unique credential ID that can be used to retrieve the stored credentials.
     */
    public static setCredentials(connectionString: string, username: string, password: string): string {
        const credentialId = Math.random().toString(36).substring(7); // maybe a hash?

        const connectionStringWithPassword = addAuthenticationDataToConnectionString(
            connectionString,
            username,
            password,
        );

        const credentials: MongoClustersCredentials = {
            credentialId: credentialId,
            connectionStringWithPassword: connectionStringWithPassword,
            connectionString: connectionString,
            connectionUser: username,
        };

        CredentialCache._store.set(credentialId, credentials);

        return credentialId;
    }
}
