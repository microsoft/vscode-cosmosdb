/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { nonNullValue, parseError, UserCancelledError, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as fse from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { ext } from '../extensionVariables';
import * as cpUtils from '../utils/cp';
import { InteractiveChildProcess } from '../utils/InteractiveChildProcess';
import { type MongoEmulatorConfiguration } from '../utils/mongoEmulatorConfiguration';
import { randomUtils } from '../utils/randomUtils';
import { getBatchSizeSetting } from '../utils/workspacUtils';
import { wrapError } from '../utils/wrapError';

const mongoExecutableFileName = process.platform === 'win32' ? 'mongo.exe' : 'mongosh';

const timeoutMessage = l10n.t(
    "Timed out trying to execute the Mongo script. To use a longer timeout, modify the VS Code 'mongo.shell.timeout' setting.",
);

const mongoShellMoreMessage = l10n.t('Type "it" for more');
const extensionMoreMessage = '(More)';

const sentinelBase = 'EXECUTION COMPLETED';
const sentinelRegex = /"?EXECUTION COMPLETED [0-9a-fA-F]{10}"?/;
function createSentinel(): string {
    return `${sentinelBase} ${randomUtils.getRandomHexString(10)}`;
}

export class MongoShellScriptRunner extends vscode.Disposable {
    private static _previousShellPathSetting: string | undefined;
    private static _cachedShellPathOrCmd: string | undefined;

    private constructor(
        private _process: InteractiveChildProcess,
        private _timeoutSeconds: number,
    ) {
        super(() => this.dispose());
    }

    public static async createShellProcessHelper(
        execPath: string,
        execArgs: string[],
        connectionString: string,
        outputChannel: vscode.OutputChannel,
        timeoutSeconds: number,
        emulatorConfiguration?: MongoEmulatorConfiguration,
    ): Promise<MongoShellScriptRunner> {
        try {
            const args: string[] = execArgs.slice() || []; // Snapshot since we modify it
            args.push(connectionString);

            if (
                emulatorConfiguration &&
                emulatorConfiguration.isEmulator &&
                emulatorConfiguration.disableEmulatorSecurity
            ) {
                // Without these the connection will fail due to the self-signed DocDB certificate
                if (args.indexOf('--tlsAllowInvalidCertificates') < 0) {
                    args.push('--tlsAllowInvalidCertificates');
                }
            }

            const process: InteractiveChildProcess = await InteractiveChildProcess.create({
                outputChannel: outputChannel,
                command: execPath,
                args,
                outputFilterSearch: sentinelRegex,
                outputFilterReplace: '',
            });
            const shell: MongoShellScriptRunner = new MongoShellScriptRunner(process, timeoutSeconds);

            /**
             * The 'unwrapIfCursor' helper is used to safely handle MongoDB queries in the shell,
             * especially for commands like db.movies.find() that return a cursor.
             *
             * When a user runs a command returning a cursor, it points to a query's result set
             * and exposes methods such as hasNext and next. Attempting to stringify
             * the raw cursor directly with EJSON.stringify can fail due to circular references
             * and other internal structures.
             *
             * To avoid this issue, 'unwrapIfCursor' checks if the returned object is indeed a
             * cursor. If it is, we manually iterate up to a fixed limit of documents, and
             * return those as a plain array. This prevents the shell from crashing or throwing
             * errors about circular structures, while still returning actual document data in
             * JSON format.
             *
             * For non-cursor commands (like db.hostInfo() or db.movies.findOne()), we
             * simply return the object unchanged.
             */
            const unwrapIfCursorFunction =
                'function unwrapIfCursor(value) {\n' +
                "    if (value && typeof value.hasNext === 'function' && typeof value.next === 'function') {\n" +
                '        const docs = [];\n' +
                '        const MAX_DOCS = 50;\n' +
                '        let count = 0;\n' +
                '        while (value.hasNext() && count < MAX_DOCS) {\n' +
                '            docs.push(value.next());\n' +
                '            count++;\n' +
                '        }\n' +
                '        if (value.hasNext()) {\n' +
                '            docs.push({ cursor: "omitted", note: "Additional results are not displayed." });\n' +
                '        }\n' +
                '        return docs;\n' +
                '    }\n' +
                '    return value;\n' +
                '}';
            process.writeLine(`${convertToSingleLine(unwrapIfCursorFunction)}`);

            // Try writing an empty script to verify the process is running correctly and allow us
            // to catch any errors related to the start-up of the process before trying to write to it.
            await shell.executeScript('');

            ext.outputChannel.appendLine(l10n.t('Mongo Shell connected.'));

            // Configure the batch size
            await shell.executeScript(`config.set("displayBatchSize", ${getBatchSizeSetting()})`);

            return shell;
        } catch (error) {
            throw wrapCheckOutputWindow(error);
        }
    }

    public static async createShell(
        context: IActionContext,
        connectionInfo: { connectionString: string; emulatorConfiguration?: MongoEmulatorConfiguration },
    ): Promise<MongoShellScriptRunner> {
        const config = vscode.workspace.getConfiguration();
        let shellPath: string | undefined = config.get(ext.settingsKeys.mongoShellPath);
        const shellArgs: string[] = config.get(ext.settingsKeys.mongoShellArgs, []);

        if (
            !shellPath ||
            !MongoShellScriptRunner._cachedShellPathOrCmd ||
            MongoShellScriptRunner._previousShellPathSetting !== shellPath
        ) {
            // Only do this if setting changed since last time
            shellPath = await MongoShellScriptRunner._determineShellPathOrCmd(context, shellPath);
            MongoShellScriptRunner._previousShellPathSetting = shellPath;
        }
        MongoShellScriptRunner._cachedShellPathOrCmd = shellPath;

        const timeout =
            1000 * nonNullValue(config.get<number>(ext.settingsKeys.mongoShellTimeout), 'mongoShellTimeout');
        return MongoShellScriptRunner.createShellProcessHelper(
            shellPath,
            shellArgs,
            connectionInfo.connectionString,
            ext.outputChannel,
            timeout,
            connectionInfo.emulatorConfiguration,
        );
    }

    public dispose(): void {
        this._process.kill();
    }

    public async useDatabase(database: string): Promise<string> {
        return await this.executeScript(`use ${database}`);
    }

    public async executeScript(script: string): Promise<string> {
        // 1. Convert to single line (existing logic)
        script = convertToSingleLine(script);

        // 2. If the user typed something, wrap it in EJSON.stringify(...)
        //    This assumes the user has typed exactly one expression that
        //    returns something (e.g. db.hostInfo(), db.myCollection.find(), etc.)
        if (script.trim().length > 0 && !script.startsWith('print(EJSON.stringify(')) {
            // Remove trailing semicolons plus any trailing space
            //    e.g. "db.hostInfo();  " => "db.hostInfo()"
            script = script.replace(/;+\s*$/, '');

            // Wrap in EJSON.stringify() and unwrapIfCursor
            script = `print(EJSON.stringify(unwrapIfCursor(${script}), null, 4))`;
        }

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

                                const responseText = removePromptLeadingAndTrailing(stdOutNoSentinel);

                                resolve(responseText);
                            }
                        }),
                    );
                    disposables.push(
                        this._process.onStdErr((text) => {
                            // Mongo shell only writes to STDERR for errors relating to starting up. Script errors go to STDOUT.
                            //   So consider this an error.
                            // (It's okay if we fire this multiple times, the first one wins.)

                            // Split the stderr text into lines, trim them, and remove empty lines
                            const lines: string[] = text
                                .split(/\r?\n/)
                                .map((l) => l.trim())
                                .filter(Boolean);

                            // Filter out lines recognized as benign debug/telemetry info
                            const unknownErrorLines: string[] = lines.filter(
                                (line) => !this.isNonErrorMongoshStderrLine(line),
                            );

                            // If there are any lines left after filtering, assume they are real errors
                            if (unknownErrorLines.length > 0) {
                                for (const line of unknownErrorLines) {
                                    ext.outputChannel.appendLine(l10n.t('Mongo Shell Error: {error}', line));
                                }
                                // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
                                reject(wrapCheckOutputWindow(unknownErrorLines.join('\n')));
                            } else {
                                // Otherwise, ignore the lines since they're known safe
                                // (e.g. "Debugger listening on ws://..." or "Using Mongosh: 1.9.0", etc.)
                            }
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
                        error = new Error(l10n.t('The process exited prematurely.'));
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

    /**
     * Checks if the stderr line from mongosh is a known "benign" message that
     * should NOT be treated as an error.
     */
    private isNonErrorMongoshStderrLine(line: string): boolean {
        /**
         * Certain versions of mongosh can print debug or telemetry messages to stderr
         * that are not actually errors (especially if VS Code auto-attach is running).
         * Below is a list of known message fragments that we can safely ignore.
         *
         * IMPORTANT: This list is not exhaustive and may need to be updated as new
         * versions of mongosh introduce new messages.
         */
        const knownNonErrorSubstrings: string[] = [
            // Node.js Inspector (auto-attach) messages:
            'Debugger listening on ws://',
            'Debugger attached.',
            'For help, see: https://nodejs.org/en/docs/inspector',

            // MongoDB Shell general info messages:
            'Current Mongosh Log ID:',
            'Using Mongosh:',
            'Using MongoDB:',

            // Telemetry or analytics prompts:
            'To enable telemetry, run:',
            'Disable telemetry by running:',

            // Occasionally, devtools or local shell info:
            'DevTools listening on ws://',
            'The server generated these startup warnings:',
        ];

        return knownNonErrorSubstrings.some((pattern) => line.includes(pattern));
    }

    private static async _determineShellPathOrCmd(
        context: IActionContext,
        shellPathSetting: string | undefined,
    ): Promise<string> {
        if (!shellPathSetting) {
            // User hasn't specified the path
            if (await cpUtils.commandSucceeds('mongo', '--version')) {
                // If the user already has mongo in their system path, just use that
                return 'mongo';
            } else {
                // If all else fails, prompt the user for the mongo path
                const openFile: vscode.MessageItem = {
                    title: l10n.t('Browse to {mongoExecutableFileName}', { mongoExecutableFileName }),
                };
                const browse: vscode.MessageItem = { title: l10n.t('Open installation page') };
                const noMongoError: string = l10n.t(
                    'This functionality requires the Mongo DB shell, but we could not find it in the path or using the mongo.shell.path setting.',
                );
                const response = await context.ui.showWarningMessage(
                    noMongoError,
                    { stepName: 'promptForMongoPath' },
                    browse,
                    openFile,
                );
                if (response === openFile) {
                    // eslint-disable-next-line no-constant-condition
                    while (true) {
                        const newPath: vscode.Uri[] = await context.ui.showOpenDialog({
                            filters: { 'Executable Files': [process.platform === 'win32' ? 'exe' : ''] },
                            openLabel: l10n.t('Select {mongoExecutableFileName}', { mongoExecutableFileName }),
                            stepName: 'openMongoExeFile',
                        });
                        const fsPath = newPath[0].fsPath;
                        const baseName = path.basename(fsPath);
                        if (baseName !== mongoExecutableFileName) {
                            const useAnyway: vscode.MessageItem = { title: l10n.t('Use anyway') };
                            const tryAgain: vscode.MessageItem = { title: l10n.t('Try again') };
                            const response2 = await context.ui.showWarningMessage(
                                l10n.t(
                                    'Expected a file name "{0}", but the selected filename is "{1}"',
                                    mongoExecutableFileName,
                                    baseName,
                                ),
                                { stepName: 'confirmMongoExeFile' },
                                useAnyway,
                                tryAgain,
                            );
                            if (response2 === tryAgain) {
                                continue;
                            }
                        }

                        await vscode.workspace
                            .getConfiguration()
                            .update(ext.settingsKeys.mongoShellPath, fsPath, vscode.ConfigurationTarget.Global);
                        return fsPath;
                    }
                } else if (response === browse) {
                    void vscode.commands.executeCommand(
                        'vscode.open',
                        vscode.Uri.parse('https://docs.mongodb.com/manual/installation/'),
                    );
                    // default down to cancel error because MongoShell.create errors out if undefined is passed as the shellPath
                }

                throw new UserCancelledError('createShell');
            }
        } else {
            // User has specified the path or command.  Sometimes they set the folder instead of a path to the file, let's check that and auto fix
            if (await fse.pathExists(shellPathSetting)) {
                const stat = await fse.stat(shellPathSetting);
                if (stat.isDirectory()) {
                    return path.join(shellPathSetting, mongoExecutableFileName);
                }
            }

            return shellPathSetting;
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

/**
 * Removes a Mongo shell prompt line if it exists at the very start or the very end of `text`.
 */
function removePromptLeadingAndTrailing(text: string): string {
    // Trim trailing spaces/newlines, but keep internal newlines.
    text = text.replace(/\s+$/, '');

    // Regex to detect standard MongoDB shell prompts:
    // 1) [mongos] secondDb>
    // 2) [mongo] test>
    // 3) globaldb [primary] SampleDB>
    const promptRegex = /^(\[mongo.*?\].*?>|.*?\[.*?\]\s+\S+>)$/;

    // Check if the *first line* contains a prompt
    const firstNewlineIndex = text.indexOf('\n');
    if (firstNewlineIndex === -1) {
        return text.replace(promptRegex, '').trim();
    }

    // Extract the first line
    const firstLine = text.substring(0, firstNewlineIndex).trim();
    if (promptRegex.test(firstLine)) {
        // Remove the prompt from the first line
        text = text.replace(firstLine, firstLine.replace(promptRegex, '').trim());
    }

    // Check if the *last line* contains a prompt
    const lastNewlineIndex = text.lastIndexOf('\n');
    if (lastNewlineIndex === -1) {
        return text.replace(promptRegex, '').trim();
    }

    const lastLine = text.substring(lastNewlineIndex + 1).trim();
    if (promptRegex.test(lastLine)) {
        // Remove the prompt from the last line
        text = text.replace(lastLine, lastLine.replace(promptRegex, '').trim());
    }

    return text;
}

async function delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}

function wrapCheckOutputWindow(error: unknown): unknown {
    const checkOutputMsg = l10n.t('The output window may contain additional information.');
    return parseError(error).message.includes(checkOutputMsg) ? error : wrapError(error, checkOutputMsg);
}
