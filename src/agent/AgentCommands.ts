/*--------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext } from "@microsoft/vscode-azext-utils";
import { writeNoSqlQueryFromSnippet } from "../docdb/registerDocDBCommands";

export async function queryCosmosDBNoSQL(context: IActionContext, queryText: string) {
    await writeNoSqlQueryFromSnippet(context, queryText);
}
