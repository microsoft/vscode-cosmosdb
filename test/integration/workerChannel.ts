/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EventEmitter } from 'node:events';
import { type Socket } from 'node:net';
import { createInterface } from 'node:readline';
import { deserialize, serialize } from 'node:v8';

// V8 serialization preserves RegExp, undefined and cyclic values in Vitest's RPC messages.
export class WorkerChannel extends EventEmitter {
    constructor(private readonly socket: Socket) {
        super();
        socket.on('error', (error) => this.emit('error', error));
        const lines = createInterface({ input: socket });
        lines.on('line', (line) => {
            let message: unknown;
            try {
                message = deserialize(Buffer.from(line, 'base64'));
            } catch (error) {
                socket.destroy(new Error('Invalid Vitest worker message.', { cause: error }));
                return;
            }
            this.emit('message', message);
        });
    }

    send(message: unknown): void {
        this.socket.write(serialize(message).toString('base64') + '\n');
    }
}
