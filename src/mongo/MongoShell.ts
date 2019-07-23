/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// TODO: process "show more" in output (mongoShowMoreMessage)

import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { ext } from '../extensionVariables';
import { InteractiveChildProcess } from '../utils/InteractiveChildProcess';
import { randomUtils } from '../utils/randomUtils';

const timeoutMessage = "Timed out trying to execute Mongo script. To use a longer timeout, modify the VS Code 'mongo.shell.timeout' setting.";

// We add these when we display to the output window
const stdInPrefix = "> ";
const stdErrPrefix = "ERR> ";

export class MongoShell extends vscode.Disposable {
	public static async create(execPath: string, execArgs: string[], connectionString: string, isEmulator: boolean): Promise<MongoShell> {
		let args: string[] = execArgs.slice() || []; // Snapshot since we modify it
		args.push(connectionString);

		if (isEmulator) {
			// Without this the connection will fail due to the self-signed DocDB certificate
			args.push("--ssl");
			args.push("--sslAllowInvalidCertificates");
		}

		let process: InteractiveChildProcess = await InteractiveChildProcess.start({
			outputChannel: ext.outputChannel,
			workingDirectory: path.dirname(execPath),
			command: execPath,
			args
		});
		let shell: MongoShell = new MongoShell(process);
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

		this._process.resetState();
		let stdOut = "";
		let stdErr = "";

		const sentinel = `$EXECUTION SENTINEL ${randomUtils.getRandomHexString(10)}$`;

		let disposables: vscode.Disposable[] = [];
		try {
			let result = await new Promise<string>(async (resolve, reject) => {
				startScriptTimeout(reject);
				disposables.push(
					this._process.onStdOut(args => {
						//stdOut += args.line;
						let { line, removed } = removeSentinel(args.line, sentinel);
						args.line = line;
						if (removed) {
							// The sentinel was found, which means we are done.
							args.line = undefined; // Don't output sentinel
							resolve(stdOut);
						} else {
							stdOut += line + os.EOL;
						}
					}));
				disposables.push(
					this._process.onStdErr(args => {
						stdErr += args.line + os.EOL;
						// Prefix output with ERR>
						args.line = stdErrPrefix + args.line;
					}));

				// Write the script to STDIN
				await this._process.writeLine(script, stdInPrefix + script);

				// Mark end of result by sending the sentinel wrapped in quotes so the console will spit
				// it back out as a string value after it's done processing the script
				let quotedSentinel = `"${sentinel}"`;
				await this._process.writeLine(quotedSentinel, ""); // (Don't display the sentinel)
			});

			if (stdErr) {
				// Mongo shell uses STDERR for things like authentication failed and invalid arguments, not for
				//   query errors, so consider any STDERR output to be a failure.
				ext.outputChannel.show();
				throw new Error(stdOut);
			}

			return result;
		}
		finally {
			this._process.flushAll(); // Allow all current output to be processed and sent to output channel

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

function removeSentinel(line: string, sentinel: string): { line: string; removed: boolean } {
	let index = line.indexOf(sentinel);
	if (index >= 0) {
		return { line: line.slice(0, index), removed: true };
	} else {
		return { line, removed: false };
	}
}
