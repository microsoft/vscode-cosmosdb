/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// CONSIDER: Run in pipeline
import * as assert from 'assert';
import * as cp from "child_process";
import * as fse from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import { isNumber } from 'util';
import * as vscode from 'vscode';
import { isWindows, MongoShell, parseError } from '../extension.bundle';
import { IDisposable } from '../src/utils/vscodeUtils';
import { setEnvironmentVariables } from './util/setEnvironmentVariables';

// grandfathered in
// tslint:disable: no-octal-literal

const VERBOSE = false; // If true, the output from the Mongo server and shell will be sent to the console for debugging purposes

let testsSupported: boolean = true;

if (!isWindows) {
    // CONSIDER: Non-Windows
    console.warn(`Not running in Windows - skipping MongoShell tests`);
    testsSupported = false;
}

suite("MongoShell", function (this: Mocha.Suite) {
    function testIfSupported(title: string, fn?: Mocha.Func | Mocha.AsyncFunc): void {
        if (testsSupported) {
            test(title, fn);
        } else {
            test(title);
        }
    }

    // CONSIDER: Make more generic
    let mongodCP: cp.ChildProcess;
    const mongodPath = "c:\\Program Files\\MongoDB\\Server\\4.2\\bin\\mongod.exe";
    const mongoPath = "c:\\Program Files\\MongoDB\\Server\\4.2\\bin\\mongo.exe";
    let mongoDOutput = "";
    let mongoDErrors = "";
    let isClosed = false;

    if (!fse.existsSync(mongodPath)) {
        console.log(`Couldn't find mongod.exe at ${mongodPath} - skipping MongoShell tests`);
        testsSupported = false;
    } else if (!fse.existsSync(mongodPath)) {
        console.log(`Couldn't find mongo.exe at ${mongoPath} - skipping MongoShell tests`);
        testsSupported = false;
    }

    class FakeOutputChannel implements vscode.OutputChannel {
        public name: string;
        public output: string;

        public append(value: string): void {
            assert(value !== undefined);
            assert(!value.includes('undefined'));
            this.output = this.output ? this.output + os.EOL + value : value;
            log(value, "Output channel: ");
        }
        public appendLine(value: string): void {
            assert(value !== undefined);
            this.append(value + os.EOL);
        }
        public clear(): void { }
        public show(preserveFocus?: boolean): void;
        public show(column?: vscode.ViewColumn, preserveFocus?: boolean): void;
        public show(_column?: any, _preserveFocus?: any) { }
        public hide(): void { }
        public dispose(): void { }
    }

    function log(text: string, linePrefix: string): void {
        text = text.replace(/(^|[\r\n]+)/g, "$1" + linePrefix);
        if (VERBOSE) {
            console.log(text);
        }
    }

    async function delay(milliseconds: number): Promise<void> {
        return new Promise(resolve => {
            // grandfathered in
            // tslint:disable-next-line: no-string-based-set-timeout
            setTimeout(resolve, milliseconds);
        });
    }

    function executeInShell(command: string): string {
        return cp.execSync(command, {}).toString();
    }

    suiteSetup(() => {
        if (testsSupported) {
            assert(fse.existsSync(mongodPath), "Couldn't find mongod.exe at " + mongodPath);
            assert(fse.existsSync(mongoPath), "Couldn't find mongo.exe at " + mongoPath);

            // Shut down any still-running mongo server
            try {
                executeInShell('taskkill /f /im mongod.exe');
            } catch (error) {
                assert(/The process .* not found/.test(parseError(error).message), `Error killing mongod: ${parseError(error).message}`);
            }

            mongodCP = cp.spawn(mongodPath, ['--quiet']);

            mongodCP.stdout.on("data", (buffer: Buffer) => {
                log(buffer.toString(), "mongo server: ");
                mongoDOutput += buffer.toString();
            });
            mongodCP.stderr.on("data", (buffer: Buffer) => {
                log(buffer.toString(), "mongo server STDERR: ");
                mongoDErrors += buffer.toString();
            });
            mongodCP.on("error", (error: unknown) => {
                log(parseError(error).message, "mongo server Error: ");
                mongoDErrors += parseError(error).message + os.EOL;
            });
            mongodCP.on("close", (code?: number) => {
                console.log(`mongo server: Close code=${code}`);
                isClosed = true;
                if (isNumber(code) && code !== 0) {
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

    testIfSupported("Verify mongod running", async () => {
        while (!mongoDOutput.includes('waiting for connections on port 27017')) {
            assert.equal(mongoDErrors, "", "Expected no errors");
            assert(!isClosed);
            await delay(50);
        }
    });

    function testShellCommand(options: {
        script: string;
        expectedResult?: string;
        expectedError?: string | RegExp;
        expectedOutput?: RegExp;
        title?: string; // Defaults to script
        args?: string[]; // Defaults to []
        mongoPath?: string; // Defaults to the correct mongo path
        env?: { [key: string]: string }; // Add to environment
        timeoutSeconds?: number;
    }): void {
        testIfSupported(options.title || options.script, async () => {
            assert(!isClosed);
            assert(mongoDErrors === "");

            let previousEnv: IDisposable;
            let shell: MongoShell | undefined;
            const outputChannel = new FakeOutputChannel();

            try {
                previousEnv = setEnvironmentVariables(options.env || {});
                shell = await MongoShell.create(options.mongoPath || mongoPath, options.args || [], '', false, outputChannel, options.timeoutSeconds || 5);
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
                    assert(options.expectedError.test(message), `Actual error did not match expected error regex. Actual error: ${message}`);
                } else if (typeof options.expectedError === 'string') {
                    assert.equal(message, options.expectedError);
                } else {
                    assert(false, `Unexpected error during the test: ${message}`);
                }

                if (options.expectedOutput instanceof RegExp) {
                    assert(options.expectedOutput.test(outputChannel.output), `Actual contents written to output channel did not match expected regex. Actual output channel contents: ${outputChannel.output}`);
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

    testShellCommand({
        script: 'use abc',
        expectedResult: 'switched to db abc'
    });

    testShellCommand({
        title: "Incorrect path",
        script: 'use abc',
        mongoPath: "/notfound/mongo.exe",
        expectedError: /Could not find .*notfound.*mongo.exe/
    });

    testShellCommand({
        title: "Find mongo through PATH",
        script: 'use abc',
        mongoPath: "mongo",
        expectedResult: 'switched to db abc',
        env: {
            PATH: process.env.path + ";" + path.dirname(mongoPath)
        }
    });

    testShellCommand({
        title: "With valid argument",
        script: 'use abc',
        args: ["--quiet"],
        expectedResult: 'switched to db abc'
    });

    testShellCommand({
        title: "With invalid argument",
        script: '',
        args: ["--hey-man-how-are-you"],
        expectedError: /Error parsing command line: unrecognised option/
    });

    testShellCommand({
        title: "Output window may contain additional information",
        script: '',
        args: ["-u", "baduser", "-p", "badpassword"],
        expectedError: /The output window may contain additional information/
    });

    testShellCommand({
        title: "With bad credentials",
        script: '',
        args: ["-u", "baduser", "-p", "badpassword"],
        expectedError: /The process exited with code 1/,
        expectedOutput: /Authentication failed/
    });

    testShellCommand({
        title: "Process exits immediately",
        script: '',
        args: ["--version"],
        expectedError: /The process exited prematurely/
    });

    testShellCommand({
        title: "Javascript",
        script: "for (var i = 0; i < 123; ++i) { }; i",
        expectedResult: "123"
    });

    testShellCommand({
        title: "Actual timeout",
        script: "for (var i = 0; i < 10000000; ++i) { }; i",
        expectedError: /Timed out trying to execute the Mongo script. To use a longer timeout, modify the VS Code 'mongo.shell.timeout' setting./,
        timeoutSeconds: 2
    });

    testIfSupported("More results than displayed (type 'it' for more -> (More))", async () => {
        const shell = await MongoShell.create(mongoPath, [], '', false, new FakeOutputChannel(), 5);
        await shell.executeScript('db.mongoShellTest.drop()');
        await shell.executeScript('for (var i = 0; i < 50; ++i) { db.mongoShellTest.insert({a:i}); }');

        const result = await shell.executeScript('db.mongoShellTest.find().pretty()');

        assert(!result.includes('Type "it" for more'));
        assert(result.includes('(More)'));

        shell.dispose();
    });
});
