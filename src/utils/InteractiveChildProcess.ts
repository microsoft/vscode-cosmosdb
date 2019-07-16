/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
import * as os from 'os';
import * as vscode from 'vscode';
import { EventEmitter, Event } from 'vscode';
import { parseError } from 'vscode-azureextensionui';
import { delay } from './delay';
import { improveError } from './improveError';

const debounceDelay = 100;

export interface IProcessResult {
    code: number;
}

export interface IInteractiveChildProcessOptions {
    command: string;
    args: string[];
    outputChannel?: vscode.OutputChannel;
    workingDirectory?: string;
    showTimeInOutputChannel?: boolean;
}

export interface IOutputEventArgs {
    text: string;
    textForOutputChannel: string; // May be modified
};

export class InteractiveChildProcess {
    private _childProc: cp.ChildProcess
    private readonly _options: IInteractiveChildProcessOptions
    private _error: unknown | undefined;
    private _startTime: number;
    private _stdOut: string;
    private _stdErr: string;

    private constructor(options: IInteractiveChildProcessOptions) {
        this._options = options;
    }

    private readonly _onStdOut: EventEmitter<IOutputEventArgs> = new EventEmitter<IOutputEventArgs>();
    public readonly onStdOut: Event<IOutputEventArgs> = this._onStdOut.event;

    private readonly _onStdErr: EventEmitter<IOutputEventArgs> = new EventEmitter<IOutputEventArgs>();
    public readonly onStdErr: Event<IOutputEventArgs> = this._onStdErr.event;

    public static async start(options: IInteractiveChildProcessOptions): Promise<InteractiveChildProcess> {
        let child: InteractiveChildProcess = new InteractiveChildProcess(options);
        await child.startCore();
        return child;
    }

    public kill(): void {
        this._childProc.kill();
    }

    public resetState(): void {
        this._stdOut = "";
        this._stdErr = "";
    }

    public async writeLine(text: string, textForDisplay?: string): Promise<void> {
        textForDisplay = textForDisplay || text;

        await delay(0);
        this.ThrowIfError();

        this.writeToOutputChannel(textForDisplay + os.EOL);
        this._childProc.stdin.write(text + os.EOL);

        await delay(0);
        this.ThrowIfError();
    }

    private setError(error: unknown): void {
        if (!this._error) {
            this._error = error;
            let parsed = parseError(error);
            this.writeToOutputChannel("Error: " + parsed.message + os.EOL);
        }
    }

    private ThrowIfError(outerError?: unknown): void {
        if (this._error) {
            throw wrapError(outerError, improveError(this._error));
        }

        if (this._childProc.killed) {
            throw new Error("The process exited prematurely");
        }
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

        this.writeToOutputChannel(`Starting executable: ${this._options.command} ${formattedArgs}${os.EOL}`);
        this._childProc = cp.spawn(this._options.command, this._options.args, options);

        this._childProc.stdout.on('data', (data: string | Buffer) => {
            let text = data.toString();
            this._stdOut += text;

            // Debounce to string consecutive data events together as much as possible
            setTimeout(() => {
                if (this._stdOut) {
                    let eventArgs: IOutputEventArgs = { text: this._stdOut, textForOutputChannel: this._stdOut };
                    this._stdOut = "";
                    this._onStdOut.fire(eventArgs);
                    this.writeToOutputChannel(eventArgs.textForOutputChannel);
                }
            }, debounceDelay);
        });

        this._childProc.stderr.on('data', (data: string | Buffer) => {
            let text = data.toString();
            this._stdErr += text;

            // Allow all current text to drain to reduce chances of getting data split
            setTimeout(() => {
                if (this._stdErr) {
                    let eventArgs: IOutputEventArgs = { text: this._stdErr, textForOutputChannel: this._stdErr };
                    this._stdErr = "";
                    this._onStdErr.fire(eventArgs);
                    this.writeToOutputChannel(eventArgs.textForOutputChannel);
                }
            }, debounceDelay);
        });

        this._childProc.on('error', (error: unknown) => {
            this.setError(error);
        });

        this._childProc.on('close', (code: number) => {
            if (code > 0) {
                this.setError(`Process exited with code ${code}`);
            }
        });

        // Give "error" event a chance to fire
        await delay(0);
        this.ThrowIfError(`Unable to start the executable`);
    }

    private writeToOutputChannel(text: string): void {
        if (this._options.outputChannel) {
            if (this._options.showTimeInOutputChannel) {
                let ms = Date.now() - this._startTime;
                text = `${ms}ms: ${text}`
            }

            this._options.outputChannel.append(text);
        }
    }
}

export interface ICommandResult {
    code: number;
    cmdOutput: string;
    cmdOutputIncludingStderr: string;
    formattedArgs: string;
}

function wrapError(outer?: unknown, innerError?: unknown): unknown {
    if (!innerError) {
        return outer;
    } else if (!outer) {
        return innerError;
    }

    let innerMessage = parseError(innerError).message;
    if (outer instanceof Error) {
        outer.message = `${outer.message}${os.EOL}${innerMessage}`;
        return outer;
    }

    return new Error(`${parseError(outer).message}${os.EOL}${innerMessage}`);
}
