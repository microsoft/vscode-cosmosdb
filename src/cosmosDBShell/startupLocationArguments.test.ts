/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ContainerDefinition, type DatabaseDefinition } from '@azure/cosmos';
import { describe, expect, it } from 'vitest';
import { getStartupLocationArguments } from './startupLocationArguments';

describe('getStartupLocationArguments', () => {
    it('passes database and container IDs as separate process arguments', () => {
        const database = { id: 'mydb' } as DatabaseDefinition;
        const container = { id: 'mycontainer' } as ContainerDefinition;

        expect(getStartupLocationArguments(database, container)).toEqual([
            '--database',
            'mydb',
            '--container',
            'mycontainer',
        ]);
    });

    it('passes only the database argument for a database-only launch', () => {
        const database = { id: 'mydb' } as DatabaseDefinition;

        expect(getStartupLocationArguments(database, undefined)).toEqual(['--database', 'mydb']);
    });

    it('omits the container when there is no database, since --container requires --database', () => {
        const container = { id: 'mycontainer' } as ContainerDefinition;

        expect(getStartupLocationArguments(undefined, container)).toEqual([]);
    });

    it('does not interpret command-shaped IDs', () => {
        const database = { id: 'db"; help' } as DatabaseDefinition;
        const container = { id: 'container\nexit' } as ContainerDefinition;

        expect(getStartupLocationArguments(database, container)).toEqual([
            '--database',
            'db"; help',
            '--container',
            'container\nexit',
        ]);
    });
});
