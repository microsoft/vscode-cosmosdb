/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Socket, type LookupFunction, type TcpSocketConnectOpts } from 'node:net';

const guardKey = Symbol.for('vscode-cosmosdb.vitest.loopbackGuard');
const ipv4 = { address: '127.0.0.1', family: 4 };
const ipv6 = { address: '::1', family: 6 };

type ConnectionOptions = Omit<Partial<TcpSocketConnectOpts>, 'port'> & { port?: unknown; path?: string };

// Keep localhost local even when a test supplies a custom DNS lookup.
const lookupLocalhost: LookupFunction = (_host, options, callback) => {
    const addresses = options.family === 6 ? [ipv6] : options.family === 4 ? [ipv4] : [ipv4, ipv6];

    if (options.all) {
        callback(null, addresses);
    } else {
        const [address] = addresses;

        callback(null, address.address, address.family);
    }
};

function getConnectionOptions([address, host]: unknown[]): ConnectionOptions {
    if (typeof address === 'object' && address !== null) {
        return address;
    }

    if (typeof address === 'string' && (address.trim() === '' || !Number.isFinite(Number(address)))) {
        return { path: address };
    }

    return { port: address, host: typeof host === 'string' ? host : undefined };
}

export function installLoopbackNetworkGuard(reportBlockedConnection: (error: Error) => void): void {
    const connect: typeof Socket.prototype.connect & { [guardKey]?: true } = Socket.prototype.connect;

    if (connect[guardKey]) {
        return;
    }

    function guardedConnect(this: Socket, ...args: unknown[]): Socket {
        // net.connect passes an already normalized [options, listener] tuple to Socket.connect.
        const connectArgs: unknown[] = Array.isArray(args[0]) ? args[0] : args;
        const options = getConnectionOptions(connectArgs);
        const host = options.host || 'localhost';

        if (options.path || host === ipv4.address || host === ipv6.address) {
            return Reflect.apply(connect, this, args) as Socket;
        }

        if (typeof host === 'string' && host.toLowerCase() === 'localhost') {
            const listener = connectArgs.at(-1);
            const lookup: LookupFunction =
                options.localAddress === ipv6.address && options.family === undefined
                    ? (hostname, lookupOptions, callback) =>
                          lookupLocalhost(hostname, { ...lookupOptions, family: 6 }, callback)
                    : lookupLocalhost;

            return Reflect.apply(connect, this, [
                { ...options, lookup },
                ...(typeof listener === 'function' ? [listener] : []),
            ]) as Socket;
        }

        const error = new Error(`TCP host blocked by the Vitest loopback guard: ${JSON.stringify(host)}.`);

        reportBlockedConnection(error);

        throw error;
    }

    Socket.prototype.connect = Object.assign(guardedConnect, { [guardKey]: true });
}
