/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The module 'assert' provides assertion methods from node
import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import * as myExtension from '../src/extension';

import * as arrayUtil from "../src/utils/array";

suite("arrayUtil Tests", () => {

    test("removeDuplicatesById", () => {
        type Elem = { id: string, data: string };
        var array1: Elem[] = [
            { id: "id1", data: "data1" },
            { id: "id2", data: "data2" },
            { id: "id2", data: "data2" },
            { id: "id1", data: "data1" },
            { id: "id2", data: "data2" }
        ];

        var result = arrayUtil.removeDuplicatesById(array1);
        assert.deepEqual(result, [{ id: "id1", data: "data1" }, { id: "id2", data: "data2" }]);
    });

    test("removeDuplicatesById_Empty", () => {
        type Elem = { id: string, data: string };
        var array1: Elem[] = [];
        var result = arrayUtil.removeDuplicatesById(array1);
        assert.deepEqual(result, []);
    });
});
