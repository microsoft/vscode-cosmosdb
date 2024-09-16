'mongodb-connection-string-url';

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
     * @param connectinString connection string with credentials
     */
    public static setConnectionString(connectinString: string): string {
        const credentialId = Math.random().toString(36).substring(7); // maybe a hash?

        const credentials = {
            credentialId: credentialId,
            connectionStringWithCredentials: connectinString,
        };

        CredentialCache._store.set(credentialId, credentials);

        return credentialId;
    }
}
