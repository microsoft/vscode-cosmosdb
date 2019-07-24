/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { setEnvironmentVariables } from './setEnvironmentVariables';

// CONSIDER: non-windows?
suite("setEnvironmentVariables", () => {
    test("restore", () => {
        let currentPath = process.env.PATH;
        let dispose = setEnvironmentVariables({ PATH: "new path" });

        assert.equal(process.env.PATH, 'new path');

        dispose.dispose();

        assert.equal(process.env.PATH, currentPath);
    });

    test("different casings", () => {
        let currentPath = process.env["paTH"];
        let dispose = setEnvironmentVariables({ "PAth": "new path" });

        assert.equal(process.env["path"], 'new path');
        assert.equal(process.env["PATH"], 'new path');

        dispose.dispose();

        assert.equal(process.env["path"], currentPath);
        assert.equal(process.env["PATH"], currentPath);
    });
});
