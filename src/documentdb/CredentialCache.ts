/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type EmulatorConfiguration } from '../utils/emulatorConfiguration';
import { addAuthenticationDataToConnectionString } from './utils/connectionStringHelpers';

export interface ClustersCredentials {
    mongoClusterId: string;
    connectionStringWithPassword?: string;
    connectionString: string;
    connectionUser: string;
    // Optional, as it's only relevant for local workspace connetions
    emulatorConfiguration?: EmulatorConfiguration;
}

export class CredentialCache {
    // the id of the cluster === the tree item id -> cluster credentials
    private static _store: Map<string, ClustersCredentials> = new Map();

    public static getConnectionStringWithPassword(mongoClusterId: string): string {
        return CredentialCache._store.get(mongoClusterId)?.connectionStringWithPassword as string;
    }

    public static hasCredentials(mongoClusterId: string): boolean {
        return CredentialCache._store.has(mongoClusterId) as boolean;
    }

    public static getEmulatorConfiguration(mongoClusterId: string): EmulatorConfiguration | undefined {
        return CredentialCache._store.get(mongoClusterId)?.emulatorConfiguration;
    }

    public static getCredentials(mongoClusterId: string): ClustersCredentials | undefined {
        return CredentialCache._store.get(mongoClusterId);
    }

    public static deleteCredentials(mongoClusterId: string): void {
        CredentialCache._store.delete(mongoClusterId);
    }

    /**
     * Sets the credentials for a given connection string and stores them in the credential cache.
     *
     * @param id - The credential id. It's supposed to be the same as the tree item id of the mongo cluster item to simplify the lookup.
     * @param connectionString - The connection string to which the credentials will be added.
     * @param username - The username to be used for authentication.
     * @param password - The password to be used for authentication.
     * @param emulatorConfiguration - The emulator configuration object (optional).
     */
    public static setCredentials(
        mongoClusterId: string,
        connectionString: string,
        username: string,
        password: string,
        emulatorConfiguration?: EmulatorConfiguration,
    ): void {
        const connectionStringWithPassword = addAuthenticationDataToConnectionString(
            connectionString,
            username,
            password,
        );

        const credentials: ClustersCredentials = {
            mongoClusterId: mongoClusterId,
            connectionStringWithPassword: connectionStringWithPassword,
            connectionString: connectionString,
            connectionUser: username,
            emulatorConfiguration: emulatorConfiguration,
        };

        CredentialCache._store.set(mongoClusterId, credentials);
    }
}
