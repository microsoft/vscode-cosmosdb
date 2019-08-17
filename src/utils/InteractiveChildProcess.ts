/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
import * as os from 'os';
import { isNumber } from 'util';
import * as vscode from 'vscode';
import { Event, EventEmitter } from 'vscode';
import { parseError } from 'vscode-azureextensionui';
import { improveError } from './improveError';

// We add these when we display to the output window
const stdInPrefix = '> ';
const stdErrPrefix = 'ERR> ';
const errorPrefix = 'Error: ';

const processStartupTimeout = 60;

export interface IInteractiveChildProcessOptions {
    command: string;
    args: string[];
    outputChannel?: vscode.OutputChannel;
    workingDirectory?: string;
    showTimeInOutputChannel?: boolean;
    outputFilterSearch?: RegExp;
    outputFilterReplace?: string;
}

export class InteractiveChildProcess {
    private _childProc: cp.ChildProcess;
    private readonly _options: IInteractiveChildProcessOptions;
    private _startTime: number;
    private _error: unknown;
    private _isKilling: boolean;

    private constructor(options: IInteractiveChildProcessOptions) {
        this._options = options;
    }

    private readonly _onStdOutEmitter: EventEmitter<string> = new EventEmitter<string>();
    public readonly onStdOut: Event<string> = this._onStdOutEmitter.event;

    private readonly _onStdErrEmitter: EventEmitter<string> = new EventEmitter<string>();
    public readonly onStdErr: Event<string> = this._onStdErrEmitter.event;

    private readonly _onErrorEmitter: EventEmitter<unknown> = new EventEmitter<unknown>();
    public readonly onError: Event<unknown> = this._onErrorEmitter.event;

    public static async create(options: IInteractiveChildProcessOptions): Promise<InteractiveChildProcess> {
        let child: InteractiveChildProcess = new InteractiveChildProcess(options);
        await child.startCore();
        return child;
    }

    public kill(): void {
        this._isKilling = true;
        this._childProc.kill();
    }

    public writeLine(text: string): void {
        this.writeLineToOutputChannel(text, stdInPrefix);
        this._childProc.stdin.write(text + os.EOL);
    }

    private async startCore(): Promise<void> {
        this._startTime = Date.now();
        const formattedArgs: string = this._options.args.join(' ');

        let workingDirectory = this._options.workingDirectory || os.tmpdir();
        const options: cp.SpawnOptions = {
            cwd: workingDirectory,

            // Using shell=true would mean that we can pass paths that will be resolved by the shell, but since
            //   the command is run in the shell, handling errors (such as command not found) would be more indirect,
            //   coming through STDERR instead of the error event
            shell: false
        };

        this.writeLineToOutputChannel(`Starting executable: "${this._options.command}" ${formattedArgs}`);
        this._childProc = cp.spawn(this._options.command, this._options.args, options);

        this._childProc.stdout.on('data', (data: string | Buffer) => {
            let text = data.toString();
            this.writeLineToOutputChannel(text);
            this._onStdOutEmitter.fire(text);
        });

        this._childProc.stderr.on('data', (data: string | Buffer) => {
            let text = data.toString();
            this._onStdErrEmitter.fire(text);
            this.writeLineToOutputChannel(text, stdErrPrefix);
        });

        this._childProc.on('error', (error: unknown) => {
            let improvedError = improveError(error);
            this.setError(improvedError);
        });

        this._childProc.on('close', (code: number | null) => {
            if (isNumber(code) && code !== 0) {
                this.setError(`The process exited with code ${code}.`);
            } else if (!this._isKilling) {
                this.setError(`The process exited prematurely.`);
            }
        });

        // Wait for the process to start up
        await new Promise<void>(async (resolve, reject) => {
            const started = Date.now();
            // tslint:disable-next-line:promise-must-complete no-constant-condition
            while (true) {
                if (!!this._error || this._isKilling) {
                    reject(this._error);
                    break;
                } else if (!!this._childProc.pid) {
                    resolve();
                    break;
                } else {
                    if (Date.now() > started + processStartupTimeout) {
                        reject("The process did not start in a timely manner");
                    }
                    await delay(50); // todo asdf timeout
                }
            }
        });
    }

    private writeLineToOutputChannel(text: string, displayPrefix?: string): void {
        let filteredText = this.filterText(text);
        let changedIntoEmptyString = (filteredText !== text && filteredText === '');

        if (!changedIntoEmptyString) {
            text = filteredText;
            if (this._options.outputChannel) {
                if (this._options.showTimeInOutputChannel) {
                    let ms = Date.now() - this._startTime;
                    text = `${ms}ms: ${text}`;
                }

                text = (displayPrefix || "") + text;
                this._options.outputChannel.appendLine(text);
            }
        }
    }

    private setError(error: unknown): void {
        this.writeLineToOutputChannel(parseError(error).message, errorPrefix);
        this._error = this._error || error;
        this._onErrorEmitter.fire(error);
    }

    private filterText(text: string): string {
        if (this._options.outputFilterSearch) {
            let filtered = text.replace(this._options.outputFilterSearch, this._options.outputFilterReplace || "");
            return filtered;
        }

        return text;
    }
}

async function delay(milliseconds: number): Promise<void> {
    return new Promise(resolve => {
        // tslint:disable-next-line:no-string-based-set-timeout // false positive
        setTimeout(resolve, milliseconds);
    });
}
