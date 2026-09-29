/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { ext } from '../extensionVariables';
import { type FabricTreeElement } from '../tree/fabric-resources-view/FabricTreeElement';
import { type TreeElement } from '../tree/TreeElement';
import { copyTreeError, showTreeError } from './showTreeError';

vi.mock('vscode', () => ({
    window: { showErrorMessage: vi.fn() },
    env: { clipboard: { writeText: vi.fn() } },
}));
vi.mock('../extensionVariables', () => ({
    ext: { outputChannel: { show: vi.fn() } },
}));

describe('tree error actions', () => {
    const message = 'Error: First line\nSecond line';
    const element: TreeElement = {
        id: 'account/error',
        getTreeItem: () => ({ label: message, contextValue: 'cosmosDB.workspace;item.error' }),
    };
    let context: IActionContext;

    beforeEach(() => {
        vi.restoreAllMocks();
        vi.clearAllMocks();
        context = {
            errorHandling: { issueProperties: {} },
            telemetry: { properties: {}, measurements: {} },
            valuesToMask: [],
            get ui(): never {
                throw new Error('Unexpected user input');
            },
        };
    });

    it('copies the full error message without showing a dialog', async () => {
        const writeText = vi.spyOn(vscode.env.clipboard, 'writeText').mockResolvedValue();

        await copyTreeError(context, element);

        expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
        expect(writeText).toHaveBeenCalledWith(message);
        expect(context.valuesToMask).toEqual([message]);
        expect(ext.outputChannel.show).not.toHaveBeenCalled();
    });

    it('opens the output channel directly without showing a dialog', () => {
        const writeText = vi.spyOn(vscode.env.clipboard, 'writeText').mockResolvedValue();
        showTreeError();
        expect(ext.outputChannel.show).toHaveBeenCalledOnce();
        expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
        expect(writeText).not.toHaveBeenCalled();
    });

    it('copies errors from Fabric tree wrappers', async () => {
        const node: FabricTreeElement = {
            id: element.id,
            element,
            getChildNodes: async () => [],
        };
        const writeText = vi.spyOn(vscode.env.clipboard, 'writeText').mockResolvedValue();
        await copyTreeError(context, node);
        expect(writeText).toHaveBeenCalledWith(message);
        expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    });

    it('copies structured tree item labels', async () => {
        const writeText = vi.spyOn(vscode.env.clipboard, 'writeText').mockResolvedValue();
        await copyTreeError(context, {
            id: element.id,
            getTreeItem: async () => ({ label: { label: message } }),
        });
        expect(writeText).toHaveBeenCalledWith(message);
    });

    it('reports a missing node or message to command error handling', async () => {
        const writeText = vi.spyOn(vscode.env.clipboard, 'writeText').mockResolvedValue();
        await expect(copyTreeError(context)).rejects.toThrow('Select an error node');
        await expect(copyTreeError(context, { id: 'empty', getTreeItem: () => ({}) })).rejects.toThrow(
            'no error message',
        );
        expect(writeText).not.toHaveBeenCalled();
        expect(ext.outputChannel.show).not.toHaveBeenCalled();
    });

    it('propagates clipboard failures to command error handling', async () => {
        vi.spyOn(vscode.env.clipboard, 'writeText').mockRejectedValue(new Error('Clipboard unavailable'));
        await expect(copyTreeError(context, element)).rejects.toThrow('Clipboard unavailable');
    });
});
