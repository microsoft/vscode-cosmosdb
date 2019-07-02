/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { splitArguments } from '../extension.bundle';

suite("splitArguments Tests", () => {
    function testSplitArguments(args: string, expected: string[]): void {
        test(String(args), () => {
            let actual = splitArguments(args);
            assert.deepStrictEqual(actual, expected);
        });
    }

    testSplitArguments(undefined, []);
    testSplitArguments(null, []);
    testSplitArguments("", []);

    testSplitArguments("a", ["a"]);
    testSplitArguments("abc", ["abc"]);
    testSplitArguments("-abc", ["-abc"]);
    testSplitArguments("--abc", ["--abc"]);
    testSplitArguments("-abc def ghi", ["-abc", "def", "ghi"]);
    testSplitArguments("abc def.exe ghi!jkl", ["abc", "def.exe", "ghi!jkl"]);

    testSplitArguments("'-abc' def ghi", ["'-abc'", "def", "ghi"]);
    testSplitArguments("'-abc def' ghi", ["'-abc def'", "ghi"]);
    testSplitArguments("-abc 'def ghi'", ["-abc", "'def ghi'"]);

    testSplitArguments('"-abc" def ghi', ['"-abc"', 'def', 'ghi']);
    testSplitArguments('"-abc def" ghi', ['"-abc def"', 'ghi']);
    testSplitArguments('-abc "def ghi"', ['-abc', '"def ghi"']);
});
