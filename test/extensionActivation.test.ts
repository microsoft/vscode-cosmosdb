/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as vscode from 'vscode';

const EXTENSION_ID = 'ms-azuretools.vscode-cosmosdb';
const testOptions = { timeout: 20_000 };

describe('extension activation (integration)', () => {
    it('exposes a real vscode API surface (not the unit-test mock)', testOptions, async () => {
        // The real extension host exposes hundreds of built-in commands.
        // The unit-test mock returns an empty array. This proves we are inside the real host.
        const commands = await vscode.commands.getCommands();
        assert.ok(commands.length > 50, `Expected over 50 VS Code commands, got ${commands.length}`);
    });

    it('finds and activates the cosmosdb extension', testOptions, async () => {
        const extension = vscode.extensions.getExtension(EXTENSION_ID);
        assert.ok(extension, `extension ${EXTENSION_ID} should be installed`);
        if (!extension.isActive) {
            await extension.activate();
        }
        assert.equal(extension.isActive, true);
    });

    it('contributes the azureDatabases.refresh command after activation', testOptions, async () => {
        const commands = await vscode.commands.getCommands(/* filterInternal */ true);
        assert.ok(commands.includes('azureDatabases.refresh'), 'Expected the azureDatabases.refresh command');
    });
});
