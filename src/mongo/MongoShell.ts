/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parseError } from '@microsoft/vscode-azext-utils';
import * as os from 'os';
import * as vscode from 'vscode';
import { InteractiveChildProcess } from '../utils/InteractiveChildProcess';
import { randomUtils } from '../utils/randomUtils';
import { getBatchSizeSetting } from '../utils/workspacUtils';
import { wrapError } from '../utils/wrapError';

const timeoutMessage =
    "Timed out trying to execute the Mongo script. To use a longer timeout, modify the VS Code 'mongo.shell.timeout' setting.";

const mongoShellMoreMessage = 'Type "it" for more';
const extensionMoreMessage = '(More)';

const sentinelBase = 'EXECUTION COMPLETED';
const sentinelRegex = /"?EXECUTION COMPLETED [0-9a-fA-F]{10}"?/;
function createSentinel(): string {
    return `${sentinelBase} ${randomUtils.getRandomHexString(10)}`;
}

export class MongoShell extends vscode.Disposable {
    constructor(
        private _process: InteractiveChildProcess,
        private _timeoutSeconds: number,
    ) {
        super(() => this.dispose());
    }

    public static async create(
        execPath: string,
        execArgs: string[],
        connectionString: string,
        isEmulator: boolean | undefined,
        outputChannel: vscode.OutputChannel,
        timeoutSeconds: number,
    ): Promise<MongoShell> {
        try {
            const args: string[] = execArgs.slice() || []; // Snapshot since we modify it
            args.push(connectionString);

            if (isEmulator) {
                // Without these the connection will fail due to the self-signed DocDB certificate
                if (args.indexOf('--ssl') < 0) {
                    args.push('--ssl');
                }
                if (args.indexOf('--sslAllowInvalidCertificates') < 0) {
                    args.push('--sslAllowInvalidCertificates');
                }
            }

            const process: InteractiveChildProcess = await InteractiveChildProcess.create({
                outputChannel: outputChannel,
                command: execPath,
                args,
                outputFilterSearch: sentinelRegex,
                outputFilterReplace: '',
            });
            const shell: MongoShell = new MongoShell(process, timeoutSeconds);

            // Try writing an empty script to verify the process is running correctly and allow us
            // to catch any errors related to the start-up of the process before trying to write to it.
            await shell.executeScript('');

            // Configure the batch size
            await shell.executeScript(`DBQuery.shellBatchSize = ${getBatchSizeSetting()}`);

            return shell;
        } catch (error) {
            throw wrapCheckOutputWindow(error);
        }
    }

    public dispose(): void {
        this._process.kill();
    }

    public async useDatabase(database: string): Promise<string> {
        return await this.executeScript(`use ${database}`);
    }

    public async executeScript(script: string): Promise<string> {
        script = convertToSingleLine(script);

        let stdOut = '';
        const sentinel = createSentinel();

        const disposables: vscode.Disposable[] = [];
        try {
            // eslint-disable-next-line @typescript-eslint/no-misused-promises, no-async-promise-executor
            const result = await new Promise<string>(async (resolve, reject) => {
                try {
                    startScriptTimeout(this._timeoutSeconds, reject);

                    // Hook up events
                    disposables.push(
                        this._process.onStdOut((text) => {
                            stdOut += text;
                            // eslint-disable-next-line prefer-const
                            let { text: stdOutNoSentinel, removed } = removeSentinel(stdOut, sentinel);
                            if (removed) {
                                // The sentinel was found, which means we are done.

                                // Change the "type 'it' for more" message to one that doesn't ask users to type anything,
                                //   since we're not currently interactive like that.
                                // CONSIDER: Ideally we would allow users to click a button to iterate through more data,
                                //   or even just do it for them
                                stdOutNoSentinel = stdOutNoSentinel.replace(
                                    mongoShellMoreMessage,
                                    extensionMoreMessage,
                                );

                                resolve(stdOutNoSentinel);
                            }
                        }),
                    );
                    disposables.push(
                        this._process.onStdErr((text) => {
                            // Mongo shell only writes to STDERR for errors relating to starting up. Script errors go to STDOUT.
                            //   So consider this an error.
                            // (It's okay if we fire this multiple times, the first one wins.)
                            // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
                            reject(wrapCheckOutputWindow(text.trim()));
                        }),
                    );
                    disposables.push(
                        this._process.onError((error) => {
                            // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
                            reject(error);
                        }),
                    );

                    // Write the script to STDIN
                    if (script) {
                        this._process.writeLine(script);
                    }

                    // Mark end of result by sending the sentinel wrapped in quotes so the console will spit
                    // it back out as a string value after it's done processing the script
                    const quotedSentinel = `"${sentinel}"`;
                    this._process.writeLine(quotedSentinel); // (Don't display the sentinel)
                } catch (error) {
                    // new Promise() doesn't seem to catch exceptions in an async function, we need to explicitly reject it

                    if ((<{ code?: string }>error).code === 'EPIPE') {
                        // Give a chance for start-up errors to show up before rejecting with this more general error message
                        await delay(500);
                        // eslint-disable-next-line no-ex-assign
                        error = new Error('The process exited prematurely.');
                    }

                    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
                    reject(wrapCheckOutputWindow(error));
                }
            });

            return result.trim();
        } finally {
            // Dispose event handlers
            for (const d of disposables) {
                d.dispose();
            }
        }
    }
}

function startScriptTimeout(timeoutSeconds: number, reject: (err: unknown) => void): void {
    if (timeoutSeconds > 0) {
        setTimeout(() => {
            reject(timeoutMessage);
        }, timeoutSeconds * 1000);
    }
}

function convertToSingleLine(script: string): string {
    return script
        .split(os.EOL)
        .map((line) => line.trim())
        .join('');
}

function removeSentinel(text: string, sentinel: string): { text: string; removed: boolean } {
    const index = text.indexOf(sentinel);
    if (index >= 0) {
        return { text: text.slice(0, index), removed: true };
    } else {
        return { text, removed: false };
    }
}

async function delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}

function wrapCheckOutputWindow(error: unknown): unknown {
    const checkOutputMsg = 'The output window may contain additional information.';
    return parseError(error).message.includes(checkOutputMsg) ? error : wrapError(error, checkOutputMsg);
}
