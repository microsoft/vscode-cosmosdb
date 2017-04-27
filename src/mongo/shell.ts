import * as cp from 'child_process';
import * as vscode from 'vscode';
import * as os from 'os';
import { IDisposable, toDisposable, dispose } from './../util';
import { EventEmitter, window } from 'vscode';

export class Shell {

	private executionId: number = 0;
	private disposables: IDisposable[] = [];

	private onResult: EventEmitter<{ exitCode, result, stderr }> = new EventEmitter<{ exitCode, result, stderr }>();

	public static create(execPath: string, connectionString: string): Promise<Shell> {
		return new Promise((c, e) => {
			try {
				cp.exec(`which ${execPath}`, err => {
					if (err) {
						e(`Error while creating mongo shell with path ${execPath}: ${err}`);
					}
					const shellProcess = cp.spawn(execPath, ['--quiet', connectionString]);
					return c(new Shell(shellProcess));
				});
			} catch (error) {
				e(`Error while creating mongo shell with path ${execPath}: ${error}`);
			}
		});
	}

	constructor(private mongoShell: cp.ChildProcess) {
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
			if ((<string>b.toString()).endsWith(`${this.executionId}\n`)) {
				const result = buffers.join('');
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

	async useDatabase(databse: string): Promise<string> {
		return this.exec(`use ${databse}`);
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
		const once = (ee: NodeJS.EventEmitter, name: string, fn: Function) => {
			ee.once(name, fn);
			disposables.push(toDisposable(() => ee.removeListener(name, fn)));
		};

		return await new Promise<string>((c, e) => {
			const disposable = this.onResult.event(result => {
				disposable.dispose();
				let lines = (<string>result.result).split('\n').filter(line => !!line && line !== 'Type "it" for more');
				lines = lines[lines.length - 1] === 'Type "it" for more' ? lines.splice(lines.length - 1, 1) : lines;
				let value = lines.join('\n');
				c(lines.join('\n'));
			})
		});
	}

	private convertToSingleLine(script: string): string {
		return script.split('\n')
			.map(line => line.trim())
			.join('')
			.trim();

	}

	private _generateExecutionSequenceId(): string {
		return `${++this.executionId}`;
	}
}