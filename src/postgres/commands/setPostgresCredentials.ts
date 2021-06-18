/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ext } from "../../extensionVariables";
import { PostgresServerTreeItem } from "../tree/PostgresServerTreeItem";

interface IPersistedServer {
    id: string;
    username: string;
}

export async function setPostgresCredentials(username: string, password: string, serverId: string): Promise<void> {
    if (ext.keytar) {
        const serviceName: string = PostgresServerTreeItem.serviceName;
        const storedValue: string | undefined = ext.context.globalState.get(serviceName);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        let servers: IPersistedServer[] = storedValue ? JSON.parse(storedValue) : [];

        // Remove this server from the cache if it's there
        servers = servers.filter((server: IPersistedServer) => { return server.id !== serverId; });

        const newServer: IPersistedServer = {
            id: serverId,
            username
        };

        servers.push(newServer);
        await ext.context.globalState.update(serviceName, JSON.stringify(servers));
        await ext.keytar.setPassword(serviceName, serverId, password);
    }
}
