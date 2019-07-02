/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as cp from 'child_process';
import * as os from 'os';
import * as vscode from "vscode";
import { EventEmitter } from 'vscode';
import { parseError } from 'vscode-azureextensionui';
import { ext } from '../extensionVariables';
import { splitArguments } from '../utils/splitArguments';

type CommandResult = {
	result?: string;
	errorMessage?: string;
};

// This is used at the end of each command we send to the console. When we get this string back,
// we know we've reached the end of that command's result.
const endOfDataSentinelBase: string = '$EOD$';

const mongoShowMoreMessage: string = 'Type "it" for more';
const prematureExitMessage: string = `The Mongo console exited prematurely. Check the output window for possible additional data, and check your mongo.shell.path and mongo.shell.args settings.`;

export class Shell {
	private _executionId: number = 0;
	private _stdoutData: string = "";
	private _stderrData: string = "";
	private _exited: boolean;

	private _onResult: EventEmitter<CommandResult> = new EventEmitter<CommandResult>();

	public static create(execPath: string, execArgs: string, connectionString: string, isEmulator: boolean): Promise<Shell> {
		return new Promise((resolve, reject) => {
			let args: string[] = [];
			try {
				args = splitArguments(execArgs);
				args = args.concat(['--quiet', connectionString]);
				if (isEmulator) {
					// Without this the connection will fail due to the self-signed DocDB certificate
					args.push("--ssl");
					args.push("--sslAllowInvalidCertificates");
				}
				const shellProcess = cp.spawn(execPath, args);
				return resolve(new Shell(execPath, args, shellProcess));
			} catch (error) {
				reject(`Error while creating mongo shell with path '${execPath}' and arguments ${JSON.stringify(args)}: ${error}`);
			}
		});
	}

	constructor(private _execPath: string, private _execArgs: string[], private _mongoShell: cp.ChildProcess) {
		this._mongoShell.on('error', (error: unknown) => {
			this.fireError(error);
		});
		this._mongoShell.on('exit', (exitCode: number, signal: string) => {
			this._exited = true;

			// One of exitCode/signal will always be non-null
			let message = signal ? `Mongo shell exited with signal '${signal}.'` : `Mongo shell exited with code ${exitCode}.`;
			this.fireError(message);
		});

		// Monitor STDOUT
		this._mongoShell.stdout.on('data', (chunk: Buffer) => {
			let data: string = chunk.toString();
			this._stdoutData += data;
			const endOfDataSentinel = `${endOfDataSentinelBase}${this._executionId}${os.EOL}`;
			if (this._stdoutData.endsWith(endOfDataSentinel)) {
				const result: string = this._stdoutData.substring(0, this._stdoutData.length - endOfDataSentinel.length);
				this.fireResult(result);
			} else {
				this._stdoutData += data;
			}
		});

		// Monitor STDERR
		this._mongoShell.stderr.on('data', (buffer: Buffer) => {
			this._stderrData += buffer.toString();
		});
		this._mongoShell.stderr.on('end', () => {
			if (this._stderrData) {
				this.fireError(this._stderrData);
			}
		});
	}

	private fireResult(result: string): void {
		this._onResult.fire(<CommandResult>{ result });
	}

	private fireError(error: string | unknown): void {
		let message: string = typeof error === 'string' ? error : parseError(error).message;
		if (typeof error === "object" && error["code"] === 'ERR_STREAM_DESTROYED') {
			message = prematureExitMessage;
		}
		this._onResult.fire(<CommandResult>{ errorMessage: message });
	}

	public async useDatabase(database: string): Promise<string> {
		return await this.executeScript(`use ${database}`);
	}

	public async executeScript(script: string): Promise<string> {
		if (this._mongoShell.killed || this._exited) {
			throw new Error(prematureExitMessage);
		}

		this._stdoutData = "";
		this._stderrData = "";
		script = this.convertToSingleLine(script);
		const executionId = this._generateExecutionSequenceId();
		const shellDetails = `Shell path: "${this._execPath}", arguments: ${JSON.stringify(this._execArgs)}`;

		try {
			this._mongoShell.stdin.write(script, 'utf8');
			this._mongoShell.stdin.write(os.EOL);

			// Mark end of result by sending the sentinel wrapped in quotes so the console will spit
			// it back out as a string value
			this._mongoShell.stdin.write(`"${endOfDataSentinelBase}${executionId}"`, 'utf8');
			this._mongoShell.stdin.write(os.EOL);
		} catch (error) {
			// Generally if writing to the process' stdin fails it has already exited
			// with an error, and we will get notification via its stdout. So delay this long
			// enough for other notifications to be a given a to fire first.
			setTimeout(() => this.fireError(error), 500);
		}

		return await new Promise<string>((resolve, reject) => {
			// Start timeout timer
			let timeout: number = 1000 * vscode.workspace.getConfiguration().get<number>(ext.settingsKeys.mongoShellTimeout);
			if (timeout <= 0) {
				// No timeout (Number.MAX_SAFE_INTEGER apparently is not valid, so use a full day)
				timeout = 24 * 60 * 60 * 1000;
			}
			const timeoutHandler = setTimeout(
				() => {
					reject(`Timed out executing MongoDB command "${script}". To use a longer timeout, modify the VS Code 'mongo.shell.timeout' setting.`);
				},
				timeout);

			// Handle result or error from the console (via fireOnResultOrError)
			const disposable = this._onResult.event((result: CommandResult) => {
				clearTimeout(timeoutHandler);

				// Only the first result or error will be processed, all others ignored
				disposable.dispose();

				// Give STDOUT/STDERR a chance to empty
				setTimeout(
					() => {
						if (result.result !== undefined && !this._stderrData) {
							if (this._mongoShell.killed || this._exited) {
								throw new Error(prematureExitMessage);
							}

							let lines = result.result.split(os.EOL).filter(line => !!line);
							if (lines[lines.length - 1] === mongoShowMoreMessage) {
								// CONSIDER: Ideally we would ask or allow the user to ask for more data
								lines = lines.splice(0, lines.length - 1);
								lines.push("(More)");
							}

							let text = lines.join(os.EOL);
							resolve(text);
						} else {
							// An error occurred
							let errorDetails = result.errorMessage || "";
							if (errorDetails.includes('ENOENT')) {
								reject(`This functionality requires the Mongo DB shell, but we could not find it. Please make sure it is on your path or you have set the '${ext.settingsKeys.mongoShellPath}' VS Code setting to point to the Mongo shell executable folder and file path.`
									+ ` ${shellDetails}`
								);
								return;
							}

							if (!errorDetails) {
								if (this._stderrData) {
									errorDetails = this._stderrData;
									this._stderrData = "";
								} else {
									errorDetails = "Unknown error";
								}
							}

							ext.outputChannel.appendLine(`Shell execution details: ${shellDetails}`);

							// Add some STDOUT/STDERR context if available
							const maxOutputLengthInMessage = 500;
							if (this._stderrData) {
								errorDetails += `${os.EOL}${os.EOL}${this._stderrData}`.slice(0, maxOutputLengthInMessage);
							}
							if (this._stdoutData) {
								errorDetails += `${os.EOL}${os.EOL}${this._stdoutData}`.slice(0, maxOutputLengthInMessage);
							}

							let message = `An error occurred executing the MongoDB command "${script}". ${errorDetails}`;

							reject(message);
						}
					},
					100);
			});
		});
	}

	private convertToSingleLine(script: string): string {
		return script.split(os.EOL)
			.map(line => line.trim())
			.join('')
			.trim();

	}

	private _generateExecutionSequenceId(): string {
		return `${++this._executionId}`;
	}
}
