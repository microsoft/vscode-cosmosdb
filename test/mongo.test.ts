/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { parseError, MongoShell } from '../extension.bundle';
import * as cp from "child_process";
import { isNumber } from 'util';
//import * as fse from 'fs-extra';

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

    suiteSetup(() => {
        // assert(fs.existsSync(mongodPath), "Couldn't find mongod.exe at " + mongodPath);
        // assert(fs.existsSync(mongodPath), "Couldn't find mongo.exe at " + mongoPath);

        mongodCP = cp.spawn(`\"${mongodPath}\"`, ['--quiet'], { shell: true });

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
            errors += parseError(error).message;
        });
        mongodCP.on("close", (code?: number) => {
            console.log("mongod: Close code=" + code);
            isClosed = true;
            if (isNumber(code) && code !== 0) {
                errors += "Closed with code " + code;
            }
        });
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
        expectedError?: string;
        title?: string; // Defaults to script
        args?: string[]; // Defaults to []
        incorrectPath?: string; // Defaults to the correct mongo path
    }): void {
        test(options.script, async () => {
            assert(!isClosed);
            assert(errors === "");

            let shell = await MongoShell.create(options.incorrectPath || mongoPath, options.args || [], '', false);
            let result = await shell.executeScript(options.script);
            try {
                assert(options.expectedError === undefined, `Expected error '${options.expectedError}'`);
                assert.equal(result, options.expected);
            } catch (error) {
                assert.equal(parseError(error).message, options.expectedError);
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
        expectedError: 'switched to db abc'
    });

    suiteTeardown(() => {
        mongodCP.kill();
    });
});

export async function delay(milliseconds: number): Promise<void> {
    return new Promise(resolve => {
        setTimeout(resolve, milliseconds);
    })
}
