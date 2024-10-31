/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { addAuthenticationDataToConnectionString } from './utils/connectionStringHelpers';

export interface MongoClustersCredentials {
    mongoClusterId: string;
    connectionStringWithPassword?: string; // wipe it after use
    connectionString: string;
    connectionUser: string;
}

export class CredentialCache {
    // the id of the cluster === the tree item id -> mongoClusters credentials
    private static _store: Map<string, MongoClustersCredentials> = new Map();

    public static getConnectionStringWithPassword(mongoClusterId: string): string {
        return CredentialCache._store.get(mongoClusterId)?.connectionStringWithPassword as string;
    }

    public static hasCredentials(mongoClusterId: string): boolean {
        return CredentialCache._store.has(mongoClusterId) as boolean;
    }

    public static getCredentials(mongoClusterId: string): MongoClustersCredentials | undefined {
        return CredentialCache._store.get(mongoClusterId);
    }

    public static deleteCredentials(mongoClusterId: string): void {
        CredentialCache._store.delete(mongoClusterId);
    }

    /**
     *
     * @param connectionString connection string with credentials
     */
    /**
     * Sets the credentials for a given connection string and stores them in the credential cache.
     *
     * @param id - The credential id. It's supposed to be the same as the tree item id of the mongo cluster item to simplify the lookup.
     * @param connectionString - The connection string to which the credentials will be added.
     * @param username - The username to be used for authentication.
     * @param password - The password to be used for authentication.
     */
    public static setCredentials(mongoClusterId: string, connectionString: string, username: string, password: string) {
        const connectionStringWithPassword = addAuthenticationDataToConnectionString(
            connectionString,
            username,
            password,
        );

        const credentials: MongoClustersCredentials = {
            mongoClusterId: mongoClusterId,
            connectionStringWithPassword: connectionStringWithPassword,
            connectionString: connectionString,
            connectionUser: username,
        };

        CredentialCache._store.set(mongoClusterId, credentials);
    }
}
