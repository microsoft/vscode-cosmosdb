/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ContainerDefinition, type DatabaseDefinition } from '@azure/cosmos';

// Escapes a value for embedding inside a Cosmos DB Shell double-quoted string literal, so
// database/container IDs containing quotes, backslashes, or statement separators (`;`, newlines)
// can't break out of the string and inject additional shell commands. `$` is escaped too:
// even inside an intact, properly-quoted string, CosmosDBShell expands `$name` and executes
// `$(...)` as a nested command (e.g. `echo "$((help))"` runs `help`), so a literal `$` must
// never reach the shell unescaped regardless of quoting.
export function escapeCosmosDBShellStringLiteral(value: string | undefined): string {
    return (value ?? '')
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\$/g, '\\$')
        .replace(/\r/g, '\\r')
        .replace(/\n/g, '\\n')
        .replace(/\t/g, '\\t');
}

export function getGoToContainerCommand(
    database: DatabaseDefinition | undefined,
    container: ContainerDefinition | undefined,
): string | undefined {
    if (database && container) {
        return `cd "/${escapeCosmosDBShellStringLiteral(database.id)}/${escapeCosmosDBShellStringLiteral(container.id)}"`;
    } else if (database) {
        return `cd "/${escapeCosmosDBShellStringLiteral(database.id)}"`;
    }
    return undefined;
}
