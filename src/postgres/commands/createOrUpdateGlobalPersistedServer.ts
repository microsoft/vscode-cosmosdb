/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IPersistedServer } from "../../constants";
import { ext } from "../../extensionVariables";
import { PostgresServerTreeItem } from "../tree/PostgresServerTreeItem";

export async function createOrUpdateGlobalPersistedServer(persistedServer: IPersistedServer, password?: string,): Promise<void> {
    if (ext.keytar) {
        const serviceName: string = PostgresServerTreeItem.serviceName;
        const storedValue: string | undefined = ext.context.globalState.get(serviceName);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        let servers: IPersistedServer[] = storedValue ? JSON.parse(storedValue) : [];

        // Remove this server from the cache if it's there
        servers = servers.filter((server: IPersistedServer) => { return server.id !== persistedServer.id; });

        servers.push(persistedServer);
        await ext.context.globalState.update(serviceName, JSON.stringify(servers));
        if (password) {
            await ext.keytar.setPassword(serviceName, persistedServer.id, password);
        }
    }
}
