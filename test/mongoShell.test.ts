/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { parseError, MongoShell } from '../extension.bundle';
import * as cp from "child_process";
import { isNumber } from 'util';
import * as os from 'os';
import * as path from 'path';
import { setEnvironmentVariables } from './util/setEnvironmentVariables';
import { IDisposable } from '../src/utils/vscodeUtils';
import * as fse from 'fs-extra';

suite("MongoShell", () => {
    let mongodCP: cp.ChildProcess;
    let mongodPath = "c:\\Program Files\\MongoDB\\Server\\4.0\\bin\\mongod.exe";
    let mongoPath = "c:\\Program Files\\MongoDB\\Server\\4.0\\bin\\mongo.exe";
    let output = "";
    let errors = "";
    let isClosed = false;

    function log(text: string, linePrefix: string): void {
        text = text.replace(/(^|[\r\n]+)/g, "$1" + linePrefix)
        console.log(text);
    }

    async function delay(milliseconds: number): Promise<void> {
        return new Promise(resolve => {
            setTimeout(resolve, milliseconds);
        })
    }

    function executeInShell(command: string): string {
        return cp.execSync(command,
            {
                //shell: true
            }).toString();
    }

    suiteSetup(() => {
        assert(fse.existsSync(mongodPath), "Couldn't find mongod.exe at " + mongodPath);
        assert(fse.existsSync(mongodPath), "Couldn't find mongo.exe at " + mongoPath);

        // CONSIDER: non-windows
        // Shut down any still-running mongo server
        try {
            executeInShell('taskkill /f /im mongod.exe');
        } catch (error) {
            assert(/The process .* not found/.test(parseError(error).message), `Error killing mongod: ${parseError(error).message}`);
        }

        //mongodCP = cp.spawn(`\"${mongodPath}\"`, ['--quiet'], { shell: true });
        mongodCP = cp.spawn(mongodPath, ['--quiet']);

        mongodCP.stdout.on("data", (buffer: Buffer) => {
            log(buffer.toString(), "mongod: ");
            output += buffer.toString();
        });
        mongodCP.stderr.on("data", (buffer: Buffer) => {
            log(buffer.toString(), "mongod STDERR: ");
            errors += buffer.toString();
        });
        mongodCP.on("error", (error: unknown) => {
            log(parseError(error).message, "mongod Error: ");
            errors += parseError(error).message + os.EOL;
        });
        mongodCP.on("close", (code?: number) => {
            console.log("mongod: Close code=" + code);
            isClosed = true;
            if (isNumber(code) && code !== 0) {
                errors += "Closed with code " + code + os.EOL;
            }
        });
    });

    suiteTeardown(() => {
        mongodCP.kill();
    });

    test("Verify mongod running", async () => {
        while (!output.includes('waiting for connections on port 27017')) {
            assert.equal(errors, "", "Expected no errors");
            assert(!isClosed);
            await delay(50);
        }
    });

    function testShellCommand(options: {
        script: string;
        expected?: string;
        expectedError?: string | RegExp;
        title?: string; // Defaults to script
        args?: string[]; // Defaults to []
        mongoPath?: string; // Defaults to the correct mongo path
        env?: { [key: string]: string }; // Add to environment
    }): void {
        test(options.title || options.script, async () => {
            assert(!isClosed);
            assert(errors === "");

            let previousEnv: IDisposable;
            let shell: MongoShell | undefined;

            try {
                previousEnv = setEnvironmentVariables(options.env || {});
                shell = await MongoShell.create(options.mongoPath || mongoPath, options.args || [], '', false);
                let result = await shell.executeScript(options.script);
                if (options.expectedError) {
                    assert(false, `Expected error '${options.expectedError}'`);
                }
                assert.equal(result.result, options.expected);
            } catch (error) {
                let message = parseError(error).message;

                if (options.expectedError instanceof RegExp) {
                    assert(options.expectedError.test(message), `Actual error did not match expected error regex. Actual error: ${message}`)
                } else if (typeof options.expectedError === 'string') {
                    assert.equal(message, options.expectedError);
                } else {
                    assert(false, `Unexpected error: ${message}`);
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
        expected: 'switched to db abc'
    });

    testShellCommand({
        title: "Incorrect path",
        script: 'use abc',
        mongoPath: "/notfound/mongo.exe",
        expectedError: 'Could not find /notfound/mongo.exe',
    });

    testShellCommand({
        title: "Find mongo through PATH",
        script: 'use abc',
        mongoPath: "mongo",
        expected: 'switched to db abc',
        env: {
            PATH: process.env["path"] + ";" + path.dirname(mongoPath)
        }
    });

    testShellCommand({
        title: "With valid argument",
        script: 'use abc',
        args: ["--quiet"],
        expected: 'switched to db abc'
    });

    testShellCommand({
        title: "With invalid argument",
        script: '',
        args: ["--hey-man-how-are-you"],
        expectedError: /Error parsing command line: unrecognised option/
    });

    testShellCommand({
        title: "With bad credentials",
        script: '',
        args: ["-u", "baduser", "-p", "badpassword"],
        expectedError: `There was an error executing the mongo shell. Check the output window for additional information.${os.EOL}exception: connect failed`
    });

    test("timeout");
});
