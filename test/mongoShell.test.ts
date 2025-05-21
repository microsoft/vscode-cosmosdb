/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// CONSIDER: Run in pipeline
import { AzExtFsExtra, parseError } from '@microsoft/vscode-azext-utils';
import assert from 'assert';
import * as cp from 'child_process';
import * as os from 'os';
import * as path from 'path';
import type * as vscode from 'vscode';
import { ext, isWindows, type IDisposable } from '../extension.bundle';
import { ShellScriptRunner } from '../src/documentdb/scrapbook/ShellScriptRunner';
import { runWithSetting } from './runWithSetting';
import { setEnvironmentVariables } from './util/setEnvironmentVariables';

const VERBOSE = false; // If true, the output from the Mongo server and shell will be sent to the console for debugging purposes

let testsSupported: boolean = true;

if (!isWindows) {
    // CONSIDER: Non-Windows
    console.warn(`Not running in Windows - skipping MongoShell tests`);
    testsSupported = false;
}

suite('MongoShell', async function (this: Mocha.Suite): Promise<void> {
    // https://github.com/mochajs/mocha/issues/2025
    this.timeout(10000);

    async function testIfSupported(title: string, fn?: Mocha.Func | Mocha.AsyncFunc): Promise<void> {
        await runWithSetting(ext.settingsKeys.mongoShellTimeout, '60', async () => {
            if (testsSupported) {
                test(title, fn);
            } else {
                test(title);
            }
        });
    }

    // CONSIDER: Make more generic
    let mongodCP: cp.ChildProcess;
    const mongodPath = 'c:\\Program Files\\MongoDB\\Server\\4.2\\bin\\mongod.exe';
    const mongoPath = 'c:\\Program Files\\MongoDB\\Server\\4.2\\bin\\mongo.exe';
    let mongoDOutput = '';
    let mongoDErrors = '';
    let isClosed = false;

    if (!(await AzExtFsExtra.pathExists(mongodPath))) {
        console.log(`Couldn't find mongod.exe at ${mongodPath} - skipping MongoShell tests`);
        testsSupported = false;
    } else if (!(await AzExtFsExtra.pathExists(mongodPath))) {
        console.log(`Couldn't find mongo.exe at ${mongoPath} - skipping MongoShell tests`);
        testsSupported = false;
    } else {
        // Prevent code 100 error: https://stackoverflow.com/questions/41420466/mongodb-shuts-down-with-code-100
        await AzExtFsExtra.ensureDir('D:\\data\\db\\');
    }

    class FakeOutputChannel implements vscode.OutputChannel {
        public name: string;
        public output: string;

        public append(value: string): void {
            assert(value !== undefined);
            assert(!value.includes('undefined'));
            this.output = this.output ? this.output + os.EOL + value : value;
            log(value, 'Output channel: ');
        }
        public appendLine(value: string): void {
            assert(value !== undefined);
            this.append(value + os.EOL);
        }
        public clear(): void {}
        public show(preserveFocus?: boolean): void;
        public show(column?: vscode.ViewColumn, preserveFocus?: boolean): void;
        public show(_column?: any, _preserveFocus?: any): void {}
        public hide(): void {}
        public dispose(): void {}
        public replace(_value: string): void {}
    }

    function log(text: string, linePrefix: string): void {
        text = text.replace(/(^|[\r\n]+)/g, '$1' + linePrefix);
        if (VERBOSE) {
            console.log(text);
        }
    }

    async function delay(milliseconds: number): Promise<void> {
        return new Promise((resolve) => {
            setTimeout(resolve, milliseconds);
        });
    }

    function executeInShell(command: string): string {
        return cp.execSync(command, {}).toString();
    }

    suiteSetup(async () => {
        if (testsSupported) {
            assert(await AzExtFsExtra.pathExists(mongodPath), "Couldn't find mongod.exe at " + mongodPath);
            assert(await AzExtFsExtra.pathExists(mongoPath), "Couldn't find mongo.exe at " + mongoPath);

            // Shut down any still-running mongo server
            try {
                executeInShell('taskkill /f /im mongod.exe');
            } catch (error) {
                assert(
                    /The process .* not found/.test(parseError(error).message),
                    `Error killing mongod: ${parseError(error).message}`,
                );
            }

            mongodCP = cp.spawn(mongodPath, ['--quiet']);

            mongodCP.stdout?.on('data', (buffer: Buffer) => {
                log(buffer.toString(), 'mongo server: ');
                mongoDOutput += buffer.toString();
            });
            mongodCP.stderr?.on('data', (buffer: Buffer) => {
                log(buffer.toString(), 'mongo server STDERR: ');
                mongoDErrors += buffer.toString();
            });
            mongodCP.on('error', (error: unknown) => {
                log(parseError(error).message, 'mongo server Error: ');
                mongoDErrors += parseError(error).message + os.EOL;
            });
            mongodCP.on('close', (code?: number) => {
                console.log(`mongo server: Close code=${code}`);
                isClosed = true;
                if (typeof code === 'number' && code !== 0) {
                    mongoDErrors += `mongo server: Closed with code "${code}"${os.EOL}`;
                }
            });
        }
    });

    suiteTeardown(() => {
        if (mongodCP) {
            mongodCP.kill();
        }
    });

    await testIfSupported('Verify mongod running', async () => {
        while (!mongoDOutput.includes('waiting for connections on port 27017')) {
            assert.equal(mongoDErrors, '', 'Expected no errors');
            assert(!isClosed);
            await delay(50);
        }
    });

    async function testShellCommand(options: {
        script: string;
        expectedResult?: string;
        expectedError?: string | RegExp;
        expectedOutput?: RegExp;
        title?: string; // Defaults to script
        args?: string[]; // Defaults to []
        mongoPath?: string; // Defaults to the correct mongo path
        env?: { [key: string]: string }; // Add to environment
        timeoutSeconds?: number;
    }): Promise<void> {
        await testIfSupported(options.title || options.script, async () => {
            assert(!isClosed);
            assert(mongoDErrors === '');

            let previousEnv: IDisposable | undefined;
            let shell: ShellScriptRunner | undefined;
            const outputChannel = new FakeOutputChannel();

            try {
                previousEnv = setEnvironmentVariables(options.env || {});
                shell = await ShellScriptRunner.createShellProcessHelper(
                    options.mongoPath || mongoPath,
                    options.args || [],
                    '',
                    outputChannel,
                    options.timeoutSeconds || 5,
                    { isEmulator: false, disableEmulatorSecurity: false },
                );
                const result = await shell.executeScript(options.script);
                if (options.expectedError) {
                    assert(false, `Expected error did not occur: '${options.expectedError}'`);
                }
                if (options.expectedResult !== undefined) {
                    assert.equal(result, options.expectedResult);
                }
            } catch (error) {
                const message = parseError(error).message;

                if (options.expectedError instanceof RegExp) {
                    assert(
                        options.expectedError.test(message),
                        `Actual error did not match expected error regex. Actual error: ${message}`,
                    );
                } else if (typeof options.expectedError === 'string') {
                    assert.equal(message, options.expectedError);
                } else {
                    assert(false, `Unexpected error during the test: ${message}`);
                }

                if (options.expectedOutput instanceof RegExp) {
                    assert(
                        options.expectedOutput.test(outputChannel.output),
                        `Actual contents written to output channel did not match expected regex. Actual output channel contents: ${outputChannel.output}`,
                    );
                }
            } finally {
                if (shell) {
                    shell.dispose();
                }
                if (previousEnv) {
                    previousEnv.dispose();
                }
            }
        });
    }

    await testShellCommand({
        script: 'use abc',
        expectedResult: 'switched to db abc',
    });

    await testShellCommand({
        title: 'Incorrect path',
        script: 'use abc',
        mongoPath: '/notfound/mongo.exe',
        expectedError: /Could not find .*notfound.*mongo.exe/,
    });

    await testShellCommand({
        title: 'Find mongo through PATH',
        script: 'use abc',
        mongoPath: 'mongo',
        expectedResult: 'switched to db abc',
        env: {
            PATH: process.env.path! + ';' + path.dirname(mongoPath),
        },
    });

    await testShellCommand({
        title: 'With valid argument',
        script: 'use abc',
        args: ['--quiet'],
        expectedResult: 'switched to db abc',
    });

    await testShellCommand({
        title: 'With invalid argument',
        script: '',
        args: ['--hey-man-how-are-you'],
        expectedError: /Error parsing command line: unrecognised option/,
    });

    await testShellCommand({
        title: 'Output window may contain additional information',
        script: '',
        args: ['-u', 'baduser', '-p', 'badpassword'],
        expectedError: /The output window may contain additional information/,
    });

    await testShellCommand({
        title: 'With bad credentials',
        script: '',
        args: ['-u', 'baduser', '-p', 'badpassword'],
        expectedError: /The process exited with code 1/,
        expectedOutput: /Authentication failed/,
    });

    await testShellCommand({
        title: 'Process exits immediately',
        script: '',
        args: ['--version'],
        expectedError: /The process exited prematurely/,
    });

    await testShellCommand({
        title: 'Javascript',
        script: 'for (var i = 0; i < 123; ++i) { }; i',
        expectedResult: '123',
    });

    await testShellCommand({
        title: 'Actual timeout',
        script: 'for (var i = 0; i < 10000000; ++i) { }; i',
        expectedError:
            /Timed out trying to execute the Mongo script. To use a longer timeout, modify the VS Code 'mongo.shell.timeout' setting./,
        timeoutSeconds: 2,
    });

    await testIfSupported("More results than displayed (type 'it' for more -> (More))", async () => {
        const shell = await ShellScriptRunner.createShellProcessHelper(mongoPath, [], '', new FakeOutputChannel(), 5, {
            disableEmulatorSecurity: false,
            isEmulator: false,
        });
        await shell.executeScript('db.mongoShellTest.drop()');
        await shell.executeScript('for (var i = 0; i < 50; ++i) { db.mongoShellTest.insert({a:i}); }');

        const result = await shell.executeScript('db.mongoShellTest.find().pretty()');

        assert(!result.includes('Type "it" for more'));
        assert(result.includes('(More)'));

        shell.dispose();
    });
});
