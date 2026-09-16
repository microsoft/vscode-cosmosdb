/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { realpathSync } from 'node:fs';
import { createConnection } from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type * as VitestWorker from 'vitest/worker';
import { WorkerChannel } from './integration/workerChannel.js';

// @vscode/test-electron keeps the Extension Host alive until this promise settles.
export async function run(): Promise<void> {
    const pipe = process.env.COSMOSDB_TEST_PIPE;
    if (!pipe) {
        throw new Error('The integration test entry must be launched by the VS Code Vitest pool.');
    }

    // VS Code lowercases Windows drive letters. Load Vitest using the canonical path, like the test files,
    // or ESM creates two copies of the collector and describe()/it() cannot find the active runner.
    const workerUrl = pathToFileURL(realpathSync.native(fileURLToPath(import.meta.resolve('vitest/worker')))).href;
    const { init, runBaseTests, setupEnvironment }: typeof VitestWorker = await import(workerUrl);
    const socket = createConnection(pipe);
    const channel = new WorkerChannel(socket);
    await new Promise<void>((resolve, reject) => {
        channel.on('error', reject);
        socket.once('end', resolve);
        init({
            post: (message) => channel.send(message),
            on: (callback) => channel.on('message', callback),
            off: (callback) => channel.off('message', callback),
            runTests: (state, traces) => runBaseTests('run', state, traces),
            collectTests: (state, traces) => runBaseTests('collect', state, traces),
            setup: setupEnvironment,
        });
    });
}
