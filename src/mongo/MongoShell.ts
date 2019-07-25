/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// CONSIDER asdf: process "show more" in output (mongoShowMoreMessage)

import * as os from 'os';
import * as vscode from 'vscode';
import { ext } from '../extensionVariables';
import { InteractiveChildProcess } from '../utils/InteractiveChildProcess';
import { randomUtils } from '../utils/randomUtils';
import { wrapError } from '../utils/wrapError';
import { parseError } from 'vscode-azureextensionui';

const timeoutMessage = "Timed out trying to execute Mongo script. To use a longer timeout, modify the VS Code 'mongo.shell.timeout' setting.";

const sentinelBase = 'EXECUTION COMPLETED';
const sentinelRegex = /\"?EXECUTION COMPLETED [0-9a-fA-F]{10}\"?/;
function createSentinel(): string { return `${sentinelBase} ${randomUtils.getRandomHexString(10)}`; }

export class MongoShell extends vscode.Disposable {

	public static async create(execPath: string, execArgs: string[], connectionString: string, isEmulator: boolean, outputChannel: vscode.OutputChannel): Promise<MongoShell> {
		try {
			let args: string[] = execArgs.slice() || []; // Snapshot since we modify it
			args.push(connectionString);

			if (isEmulator) {
				// Without this the connection will fail due to the self-signed DocDB certificate
				args.push("--ssl");
				args.push("--sslAllowInvalidCertificates");
			}

			let process: InteractiveChildProcess = await InteractiveChildProcess.create({
				outputChannel: outputChannel,
				//workingDirectory: path.dirname(execPath),
				command: execPath,
				args,
				outputFilterSearch: sentinelRegex,
				outputFilterReplace: ''
			});
			let shell: MongoShell = new MongoShell(process);

			// Try writing an empty script to verify the process is running correctly and allow us
			// to catch any errors related to the start-up of the process before trying to write to it.
			await shell.executeScript("");

			return shell;
		} catch (error) {
			throw wrapCheckOutputWindow(error);
		}
	}

	constructor(private _process: InteractiveChildProcess) {
		super(() => this.dispose());
	}

	public dispose(): void {
		this._process.kill();
	}

	public async useDatabase(database: string): Promise<string> {
		return (await this.executeScript(`use ${database}`)).result;
	}

	public async executeScript(script: string): Promise<{ result: string; stdOut: string; stdErr: string }> {
		script = convertToSingleLine(script);

		let stdOut = "";
		const sentinel = createSentinel();

		let disposables: vscode.Disposable[] = [];
		try {
			let result = await new Promise<string>(async (resolve, reject) => {
				try {
					startScriptTimeout(reject);

					// Hook up events
					disposables.push(
						this._process.onStdOut(text => {
							stdOut += text;
							let { text: stdOutNoSentinel, removed } = removeSentinel(stdOut, sentinel);
							if (removed) {
								// The sentinel was found, which means we are done.
								resolve(stdOutNoSentinel);
							}
						}));
					disposables.push(
						this._process.onStdErr(text => {
							// Mongo shell only writes to STDERR for errors relating to starting up. Script errors go to STDOUT.
							//   So consider this an error.
							// (It's okay if we fire this multiple times, the first one wins.)
							reject(wrapCheckOutputWindow(text.trim()));
						}));
					disposables.push(
						this._process.onError(error => {
							reject(error);
						}));

					// Write the script to STDIN
					if (script) {
						this._process.writeLine(script);
					}

					// Mark end of result by sending the sentinel wrapped in quotes so the console will spit
					// it back out as a string value after it's done processing the script
					let quotedSentinel = `"${sentinel}"`;
					this._process.writeLine(quotedSentinel); // (Don't display the sentinel)

				} catch (error) {
					// new Promise() doesn't seem to catch exceptions in an async function, we need to explicitly reject it

					if ((<{ code?: string }>error).code === 'EPIPE') {
						// Give a chance for start-up errors to show up before rejecting with this more general error
						await delay(500);
						error = new Error("The process exited prematurely.");
					}

					reject(wrapCheckOutputWindow(error));
				}
			});

			return { result: result.trim(), stdOut, stdErr: "" }; //asdf
		}
		finally {
			// Dispose event handlers
			for (let d of disposables) {
				d.dispose();
			}
		}
	}
}

function startScriptTimeout(reject: (unknown) => void): void {
	let timeout = 1000 * vscode.workspace.getConfiguration().get<number>(ext.settingsKeys.mongoShellTimeout);
	if (timeout > 0) {
		setTimeout(
			() => {
				reject(timeoutMessage);
			},
			timeout);
	}
}

function convertToSingleLine(script: string): string {
	return script.split(os.EOL)
		.map(line => line.trim())
		.join('')
		.trim();

}

function removeSentinel(text: string, sentinel: string): { text: string; removed: boolean } {
	let index = text.indexOf(sentinel);
	if (index >= 0) {
		return { text: text.slice(0, index), removed: true };
	} else {
		return { text, removed: false };
	}
}

async function delay(milliseconds: number): Promise<void> { //asdf
	return new Promise(resolve => {
		setTimeout(resolve, milliseconds);
	})
}

function wrapCheckOutputWindow(error: unknown): unknown {
	let checkOutputMsg = "The output window may contain additional information.";
	return parseError(error).message.includes(checkOutputMsg) ? error : wrapError(error, checkOutputMsg);
}
