/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ContainerDefinition, type DatabaseDefinition } from '@azure/cosmos';

/**
 * Builds process arguments for selecting a location without sending commands to the shell.
 * `--container` is only valid alongside `--database`, so a container without a database
 * yields no location arguments at all.
 */
export function getStartupLocationArguments(
    database: DatabaseDefinition | undefined,
    container: ContainerDefinition | undefined,
): string[] {
    if (!database?.id) {
        return [];
    }

    const args = ['--database', database.id];
    if (container?.id) {
        args.push('--container', container.id);
    }
    return args;
}
