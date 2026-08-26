/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ContainerDefinition, type DatabaseDefinition } from '@azure/cosmos';
import { describe, expect, it } from 'vitest';
import { getStartupLocationArguments, getStartupNavigationArguments } from './startupLocationArguments';

describe('getStartupNavigationArguments', () => {
    it('uses database and container arguments for shells that support them', () => {
        const database = { id: 'mydb' } as DatabaseDefinition;
        const container = { id: 'mycontainer' } as ContainerDefinition;

        expect(getStartupNavigationArguments(database, container, true)).toEqual([
            '--database',
            'mydb',
            '--container',
            'mycontainer',
        ]);
    });

    it('uses an escaped startup command for older shells', () => {
        const database = { id: 'db"; help' } as DatabaseDefinition;
        const container = { id: '$((exit))' } as ContainerDefinition;

        expect(getStartupNavigationArguments(database, container, false)).toEqual([
            '-k',
            'cd "/db\\"; help/\\$((exit))"',
        ]);
    });

    it('supports database-only navigation for older shells', () => {
        const database = { id: 'mydb' } as DatabaseDefinition;

        expect(getStartupNavigationArguments(database, undefined, false)).toEqual(['-k', 'cd "/mydb"']);
    });
});

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
