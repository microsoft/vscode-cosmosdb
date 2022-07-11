/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { isIPv4 } from 'net';
import { createTestActionContext } from 'vscode-azureextensiondev';
import { getPublicIpv4 } from '../../extension.bundle';

suite("getPublicIpv4", () => {
    test("get IP", async () => {
        const context = await createTestActionContext();
        const ip = await getPublicIpv4(context);
        assert(isIPv4(ip));
    });
});
