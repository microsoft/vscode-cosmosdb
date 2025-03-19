/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parseError } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as cp from 'child_process';
import * as os from 'os';
import { isNumber } from 'util';
import * as vscode from 'vscode';
import { improveError } from './improveError';

// We add these when we display to the output window
const errorPrefix = l10n.t('Error running process: ');

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

    private readonly _onStdOutEmitter: vscode.EventEmitter<string> = new vscode.EventEmitter<string>();
    private readonly _onStdErrEmitter: vscode.EventEmitter<string> = new vscode.EventEmitter<string>();
    private readonly _onErrorEmitter: vscode.EventEmitter<unknown> = new vscode.EventEmitter<unknown>();

    private constructor(options: IInteractiveChildProcessOptions) {
        this._options = options;
    }

    public get onStdOut(): vscode.Event<string> {
        return this._onStdOutEmitter.event;
    }

    public get onStdErr(): vscode.Event<string> {
        return this._onStdErrEmitter.event;
    }

    public get onError(): vscode.Event<unknown> {
        return this._onErrorEmitter.event;
    }

    public static async create(options: IInteractiveChildProcessOptions): Promise<InteractiveChildProcess> {
        const child: InteractiveChildProcess = new InteractiveChildProcess(options);
        await child.startCore();
        return child;
    }

    public kill(): void {
        this._isKilling = true;
        this._childProc.kill();
    }

    public writeLine(text: string): void {
        this._childProc.stdin?.write(text + os.EOL);
    }

    private async startCore(): Promise<void> {
        this._startTime = Date.now();

        const workingDirectory = this._options.workingDirectory || os.tmpdir();
        const options: cp.SpawnOptions = {
            cwd: workingDirectory,

            // Using shell=true would mean that we can pass paths that will be resolved by the shell, but since
            //   the command is run in the shell, handling errors (such as command not found) would be more indirect,
            //   coming through STDERR instead of the error event
            shell: false,
        };

        this.writeLineToOutputChannel(l10n.t('Starting executable: "{command}"', { command: this._options.command }));
        this._childProc = cp.spawn(this._options.command, this._options.args, options);

        this._childProc.stdout?.on('data', (data: string | Buffer) => {
            const text = data.toString();
            this._onStdOutEmitter.fire(text);
        });

        this._childProc.stderr?.on('data', (data: string | Buffer) => {
            const text = data.toString();
            this._onStdErrEmitter.fire(text);
        });

        this._childProc.on('error', (error: unknown) => {
            const improvedError = improveError(error);
            this.setError(improvedError);
        });

        this._childProc.on('close', (code: number | null) => {
            if (isNumber(code) && code !== 0) {
                this.setError(`The process exited with code ${code}.`);
            } else if (!this._isKilling) {
                this.setError(`The process exited prematurely.`);
            }
            this.writeLineToOutputChannel(l10n.t('Process exited: "{command}"', { command: this._options.command }));
        });

        // Wait for the process to start up
        // eslint-disable-next-line @typescript-eslint/no-misused-promises, no-async-promise-executor
        await new Promise<void>(async (resolve, reject) => {
            const started = Date.now();
            // eslint-disable-next-line no-constant-condition
            while (true) {
                if (!!this._error || this._isKilling) {
                    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
                    reject(this._error);
                    break;
                } else if (this._childProc.pid) {
                    resolve();
                    break;
                } else {
                    if (Date.now() > started + processStartupTimeout) {
                        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
                        reject('The process did not start in a timely manner');
                        break;
                    }
                    await delay(50);
                }
            }
        });

        this.writeLineToOutputChannel(
            l10n.t('Started executable: "{command}". Connecting to host…', { command: this._options.command }),
        );
    }

    private writeLineToOutputChannel(text: string, displayPrefix?: string): void {
        const filteredText = this.filterText(text);
        const changedIntoEmptyString = filteredText !== text && filteredText === '';

        if (!changedIntoEmptyString) {
            text = filteredText;
            if (this._options.outputChannel) {
                if (this._options.showTimeInOutputChannel) {
                    const ms = Date.now() - this._startTime;
                    text = `${ms}ms: ${text}`;
                }

                text = (displayPrefix || '') + text;
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
            return text.replace(this._options.outputFilterSearch, this._options.outputFilterReplace || '');
        }

        return text;
    }
}

async function delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}
