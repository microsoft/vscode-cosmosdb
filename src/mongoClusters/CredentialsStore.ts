'mongodb-connection-string-url';

interface MongoClustersCredentials {
    clientId: string;
    connectionStringWithCredentials: string;
}

export class CredentialsStore {
    // clientId -> mongoClusters credentials
    private static _store: Map<string, MongoClustersCredentials> = new Map();

    public static getConnectionString(clientId: string): string {
        return CredentialsStore._store.get(clientId)?.connectionStringWithCredentials as string;
    }

    public static hasConnectionString(clientId: string): boolean {
        return CredentialsStore._store.has(clientId) as boolean;
    }

    /**
     *
     * @param connectinString connection string with credentials
     */
    public static setConnectionString(connectinString: string): string {
        const clientId = Math.random().toString(36).substring(7); // maybe a hash?

        const credentials = {
            clientId: clientId,
            connectionStringWithCredentials: connectinString,
        };

        CredentialsStore._store.set(clientId, credentials);

        return clientId;
    }
}
