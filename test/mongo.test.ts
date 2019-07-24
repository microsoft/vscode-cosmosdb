/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { parseError, MongoShell } from '../extension.bundle';
import * as cp from "child_process";
import { isNumber } from 'util';

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
            assert(!isClosed);
            assert(errors === "");
            await delay(50);
        }
    });

    async function testShellCommand(_script: string): Promise<void> {
        assert(!isClosed);
        assert(errors === "");

        let shell = await MongoShell.create(mongoPath, [], '', false);
        let result = await shell.useDatabase('abc');
        assert.equal(result, 'switched to db abc');
    }

    test("a", async () => {
        await testShellCommand('use db');
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
