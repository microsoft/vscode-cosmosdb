/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
import * as os from 'os';
import * as vscode from 'vscode';
import { Event, EventEmitter } from 'vscode';
import { parseError } from 'vscode-azureextensionui';
import { delay } from './delay';
import { improveError } from './improveError';
import { isNumber } from 'util';

export interface IInteractiveChildProcessOptions {
    command: string;
    args: string[];
    outputChannel?: vscode.OutputChannel;
    workingDirectory?: string;
    showTimeInOutputChannel?: boolean;
}

export interface IOutputEventArgs {
    // We fire the event with a single complete line at a time
    line: string | undefined;  // May be modified - what exists in this property after the event is fired will go to output channel
}

export class InteractiveChildProcess {
    private _childProc: cp.ChildProcess;
    private readonly _options: IInteractiveChildProcessOptions;
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

    public async flushAll(): Promise<void> {
        this.flushStdOut(true);
        this.flushStdErr(true);
        await this.processErrors();
    }

    public resetState(): void {
        this._stdOut = "";
        this._stdErr = "";
    }

    public async writeLine(text: string, textForDisplay?: string): Promise<void> {
        textForDisplay = textForDisplay === undefined ? text : textForDisplay;

        await this.processErrors();

        if (textForDisplay) {
            this.writeLineToOutputChannel(textForDisplay);
        }
        this._childProc.stdin.write(text + os.EOL);

        await this.processErrors();
    }

    private setError(error: unknown): void {
        if (!this._error) {
            this._error = error;
            let parsed = parseError(error);
            this.writeLineToOutputChannel("Error: " + parsed.message);
        }
    }

    private async processErrors(outerError?: unknown): Promise<void> {
        // Wait for next event loop to give any current error events a chance to be processed.
        // For instance, if the executable fails to start, it will fire an "error" event, but
        //   we won't see it until the event is processed in the event loop
        await delay(0);

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

        this.writeLineToOutputChannel(`Starting executable: ${this._options.command} ${formattedArgs}`);
        this._childProc = cp.spawn(this._options.command, this._options.args, options);

        this._childProc.stdout.on('data', (data: string | Buffer) => {
            let text = data.toString();
            this._stdOut += text;
            this.flushStdOut();
        });

        this._childProc.stderr.on('data', (data: string | Buffer) => {
            let text = data.toString();
            this._stdErr += text;

            this.flushStdErr();
        });

        this._childProc.on('error', (error: unknown) => {
            this.setError(error);
        });

        this._childProc.on('close', (code: number) => {
            this.flushAll();

            if (isNumber(code) && code !== 0) {
                this.setError(`Process exited with code ${code}. The output may contain additional information.`);
            }
        });

        await this.processErrors(`Unable to start the executable.`);
    }

    private flushStdOut(force?: boolean): void {
        this._stdOut = this.flush(this._stdOut, this._onStdOut, force);
    }

    private flushStdErr(force?: boolean): void {
        this._stdErr = this.flush(this._stdErr, this._onStdErr, force);
    }

    private writeLineToOutputChannel(text: string): void {
        if (this._options.outputChannel) {
            if (this._options.showTimeInOutputChannel) {
                let ms = Date.now() - this._startTime;
                text = `${ms}ms: ${text}`;
            }

            this._options.outputChannel.appendLine(text);
        }
    }

    private flush(data: string, event: EventEmitter<IOutputEventArgs>, force?: boolean): string {
        let { lines, remaining } = getFullLines(data);
        if (force && remaining) {
            lines.push(remaining);
            remaining = "";
        }

        for (let line of lines) {
            let eventArgs: IOutputEventArgs = { line };
            event.fire(eventArgs);
            if (eventArgs.line !== undefined) {
                this.writeLineToOutputChannel(eventArgs.line);
            }
        }

        return remaining;
    }
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

function getFullLines(data: string): { lines: string[]; remaining: string } {
    let lines: string[] = [];

    // tslint:disable-next-line:no-constant-condition
    while (true) {
        const match: RegExpMatchArray | null = data.match(/(.*)(\r\n|\n)/);
        if (match) {
            let line = match[1];
            let eol = match[2];
            data = data.slice(line.length + eol.length);
            lines.push(line);
        } else {
            break;
        }
    }

    return { lines, remaining: data };
}
