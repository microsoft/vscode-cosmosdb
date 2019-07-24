/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// CONSIDER asdf: process "show more" in output (mongoShowMoreMessage)

import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { ext } from '../extensionVariables';
import { InteractiveChildProcess } from '../utils/InteractiveChildProcess';
import { randomUtils } from '../utils/randomUtils';

const timeoutMessage = "Timed out trying to execute Mongo script. To use a longer timeout, modify the VS Code 'mongo.shell.timeout' setting.";

const sentinelBase = 'EXECUTION COMPLETED';
const sentinelRegex = /\"?EXECUTION COMPLETED [0-9a-fA-F]{10}\"?/;
function createSentinel(): string { return `${sentinelBase} ${randomUtils.getRandomHexString(10)}`; }

export class MongoShell extends vscode.Disposable {
	public static async create(execPath: string, execArgs: string[], connectionString: string, isEmulator: boolean): Promise<MongoShell> {
		let args: string[] = execArgs.slice() || []; // Snapshot since we modify it
		args.push(connectionString);

		if (isEmulator) {
			// Without this the connection will fail due to the self-signed DocDB certificate
			args.push("--ssl");
			args.push("--sslAllowInvalidCertificates");
		}

		let process: InteractiveChildProcess = await InteractiveChildProcess.create({
			outputChannel: ext.outputChannel,
			workingDirectory: path.dirname(execPath),
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
	}

	constructor(private _process: InteractiveChildProcess) {
		super(() => this.dispose());
	}

	public dispose(): void {
		this._process.kill();
	}

	public async useDatabase(database: string): Promise<string> {
		return await this.executeScript(`use ${database}`);
	}

	public async executeScript(script: string): Promise<string> {
		script = convertToSingleLine(script);

		let stdOut = "";

		const sentinel = createSentinel();

		let disposables: vscode.Disposable[] = [];
		try {
			let result = await new Promise<string>(async (resolve, reject) => {
				startScriptTimeout(reject);
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
					this._process.onError(error => {
						ext.outputChannel.show();
						reject(error);
					}));

				// Write the script to STDIN
				if (script) {
					await this._process.writeLine(script);
				}

				// Mark end of result by sending the sentinel wrapped in quotes so the console will spit
				// it back out as a string value after it's done processing the script
				let quotedSentinel = `"${sentinel}"`;
				await this._process.writeLine(quotedSentinel); // (Don't display the sentinel)
			});

			return result.trim();
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
