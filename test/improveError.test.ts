/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { improveError } from '../extension.bundle';
import { parseError } from 'vscode-azureextensionui';

suite("improveError", () => {
    test("spawn ENOENT", () => {
        let msg: string = "spawn c:\\Program Files\\MongoDB\Server\\4.0\\bin\\mongo.exe ENOENT";
        let improved: unknown = improveError(msg);

        assert.equal(parseError(improved).message, "Could not find c:\\Program Files\\MongoDB\Server\\4.0\\bin\\mongo.exe");
    });
});
