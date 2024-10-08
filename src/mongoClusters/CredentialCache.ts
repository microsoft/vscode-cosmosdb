/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

interface MongoClustersCredentials {
    credentialId: string;
    connectionStringWithCredentials: string;
}

export class CredentialCache {
    // clientId -> mongoClusters credentials
    private static _store: Map<string, MongoClustersCredentials> = new Map();

    public static getConnectionString(clientId: string): string {
        return CredentialCache._store.get(clientId)?.connectionStringWithCredentials as string;
    }

    public static hasConnectionString(clientId: string): boolean {
        return CredentialCache._store.has(clientId) as boolean;
    }

    /**
     *
     * @param connectionString connection string with credentials
     */
    public static setConnectionString(connectionString: string): string {
        const credentialId = Math.random().toString(36).substring(7); // maybe a hash?

        const credentials = {
            credentialId: credentialId,
            connectionStringWithCredentials: connectionString,
        };

        CredentialCache._store.set(credentialId, credentials);

        return credentialId;
    }
}
