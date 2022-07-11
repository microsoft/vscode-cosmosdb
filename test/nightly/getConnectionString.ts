/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { runWithTestActionContext } from '@microsoft/vscode-azext-dev';
import * as vscode from 'vscode';
import { cosmosDBCopyConnectionString } from '../../extension.bundle';

export async function getConnectionString(accountName: string): Promise<string> {
    await vscode.env.clipboard.writeText('');
    await runWithTestActionContext('cosmosDBCopyConnectionString', async context => {
        await context.ui.runWithInputs([new RegExp(accountName)], async () => {
            await cosmosDBCopyConnectionString(context);
        });
    })
    return await vscode.env.clipboard.readText();
}
