/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// TODO: process "show more" in output (mongoShowMoreMessage)

import * as os from 'os';
import * as vscode from 'vscode';
import * as path from 'path';
import { ext } from '../extensionVariables';
import { InteractiveChildProcess } from '../utils/InteractiveChildProcess';
import { randomUtils } from '../utils/randomUtils';

const timeoutMessage = "Timed out trying to execute Mongo script. To use a longer timeout, modify the VS Code 'mongo.shell.timeout' setting.";

// We add these when we display to the output window
const stdInPrefix = "> ";
const stdErrPrefix = "ERR> ";

export class Shell extends vscode.Disposable {
	public static async create(execPath: string, execArgs: string[], connectionString: string, isEmulator: boolean): Promise<Shell> {
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
		let shell: Shell = new Shell(process);
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
						stdOut += args.text;
						let { text: finalStdOut, removed } = removeSentinel(stdOut, sentinel);
						if (removed) {
							// The sentinel was found in the full stdOut string, which means we are done

							// Remove sentinel from string to be displayed (which is a subset of the full stdout)
							args.textForOutputChannel = removeSentinel(args.text, sentinel).text;

							resolve(finalStdOut);
						}
					}));
				disposables.push(
					this._process.onStdErr(args => {
						// Mongo shell uses STDERR for things like authentication failed and invalid arguments, not for
						//   query errors, so consider STDERR output to be a failure
						stdErr += args.text;
						args.textForOutputChannel = stdErrPrefix + args.textForOutputChannel;
						reject(stdErr);
					}));

				// Write out the code
				await this._process.writeLine(script, stdInPrefix + script);

				// Mark end of result by sending the sentinel wrapped in quotes so the console will spit
				// it back out as a string value after it's done processing the script
				let quotedSentinel = `"${sentinel}"`;
				await this._process.writeLine(quotedSentinel, "") // (Don't display the sentinel)
			});

			return result;
		}
		finally {
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
		return { text: text, removed: false };
	}
}
