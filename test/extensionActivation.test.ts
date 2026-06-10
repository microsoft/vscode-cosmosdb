/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import * as vscode from 'vscode';

const EXTENSION_ID = 'ms-azuretools.vscode-cosmosdb';

describe('extension activation (integration)', () => {
    it('exposes a real vscode API surface (not the unit-test mock)', async () => {
        // The real extension host exposes hundreds of built-in commands.
        // The unit-test mock returns an empty array. This proves we are inside the real host.
        const commands = await vscode.commands.getCommands();
        expect(commands.length).toBeGreaterThan(50);
    });

    it('finds and activates the cosmosdb extension', async () => {
        const extension = vscode.extensions.getExtension(EXTENSION_ID);
        expect(extension, `extension ${EXTENSION_ID} should be installed`).toBeDefined();
        if (!extension!.isActive) {
            await extension!.activate();
        }
        expect(extension!.isActive).toBe(true);
    });

    it('contributes the azureDatabases.refresh command after activation', async () => {
        const commands = await vscode.commands.getCommands(/* filterInternal */ true);
        expect(commands).toContain('azureDatabases.refresh');
    });
});
