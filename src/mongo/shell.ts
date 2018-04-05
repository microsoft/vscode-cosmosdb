/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as cp from 'child_process';
import * as os from 'os';
import { IDisposable, toDisposable } from '../utils/vscodeUtils';
import { EventEmitter, window } from 'vscode';
import { ext } from '../extensionVariables';
import { parseError, IParsedError } from 'vscode-azureextensionui';

export class Shell {

	private executionId: number = 0;
	private disposables: IDisposable[] = [];

	private onResult: EventEmitter<{ exitCode, result, stderr, code?: string, message?: string }> = new EventEmitter<{ exitCode, result, stderr, code?: string, message?: string }>();

	public static create(execPath: string, connectionString: string): Promise<Shell> {
		return new Promise((c, e) => {
			try {
				const shellProcess = cp.spawn(execPath, ['--quiet', connectionString]);
				return c(new Shell(execPath, shellProcess));
			} catch (error) {
				e(`Error while creating mongo shell with path '${execPath}': ${error}`);
			}
		});
	}

	constructor(private execPath: string, private mongoShell: cp.ChildProcess) {
		this.initialize();
	}

	private initialize() {
		const once = (ee: NodeJS.EventEmitter, name: string, fn: Function) => {
			ee.once(name, fn);
			this.disposables.push(toDisposable(() => ee.removeListener(name, fn)));
		};

		const on = (ee: NodeJS.EventEmitter, name: string, fn: Function) => {
			ee.on(name, fn);
			this.disposables.push(toDisposable(() => ee.removeListener(name, fn)));
		};

		once(this.mongoShell, 'error', result => this.onResult.fire(result));
		once(this.mongoShell, 'exit', result => this.onResult.fire(result));

		let buffers: string[] = [];
		on(this.mongoShell.stdout, 'data', b => {
			let data: string = b.toString()
			const delimitter = `${this.executionId}${os.EOL}`;
			if (data.endsWith(delimitter)) {
				const result = buffers.join('') + data.substring(0, data.length - delimitter.length);
				buffers = [];
				this.onResult.fire({
					exitCode: void 0,
					result,
					stderr: void 0
				});
			} else {
				buffers.push(b);
			}
		});

		on(this.mongoShell.stderr, 'data', result => this.onResult.fire(result));
		once(this.mongoShell.stderr, 'close', result => this.onResult.fire(result));
	}

	async useDatabase(database: string): Promise<string> {
		return this.exec(`use ${database}`);
	}

	async exec(script: string): Promise<string> {
		script = this.convertToSingleLine(script);
		const executionId = this._generateExecutionSequenceId();

		try {
			this.mongoShell.stdin.write(script, 'utf8');
			this.mongoShell.stdin.write(os.EOL);
			this.mongoShell.stdin.write(executionId, 'utf8');
			this.mongoShell.stdin.write(os.EOL);
		} catch (error) {
			window.showErrorMessage(error.toString());
		}

		const disposables: IDisposable[] = [];
		(ee: NodeJS.EventEmitter, name: string, fn: Function) => {
			ee.once(name, fn);
			disposables.push(toDisposable(() => ee.removeListener(name, fn)));
		};

		return await new Promise<string>((c, e) => {
			let executed = false;
			const handler = setTimeout(
				() => {
					if (!executed) {
						e(`Timed out executing MongoDB command "${script}"`);
					}
				},
				5000);
			const disposable = this.onResult.event(result => {
				disposable.dispose();

				if (result.code) {
					if (result.code === 'ENOENT') {
						result.message = `Could not find Mongo shell. Make sure it is on your path or you have set the '${ext.settingsKeys.mongoShellPath}' VS Code setting to point to the Mongo shell executable file. Attempted command: "${this.execPath}"`;
					}

					e(result);
					return;
				}

				let lines = (<string>result.result).split(os.EOL).filter(line => !!line && line !== 'Type "it" for more');
				lines = lines[lines.length - 1] === 'Type "it" for more' ? lines.splice(lines.length - 1, 1) : lines;
				executed = true;
				c(lines.join(os.EOL));
				if (handler) {
					clearTimeout(handler);
				}
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
		return `${++this.executionId}`;
	}
}
