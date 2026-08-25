/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ContainerDefinition, type DatabaseDefinition } from '@azure/cosmos';
import { describe, expect, it } from 'vitest';
import { escapeCosmosDBShellStringLiteral, getGoToContainerCommand } from './goToContainerCommand';

function db(id: string): DatabaseDefinition {
    return { id } as DatabaseDefinition;
}

function container(id: string): ContainerDefinition {
    return { id } as ContainerDefinition;
}

describe('escapeCosmosDBShellStringLiteral', () => {
    it('escapes quotes, backslashes, and control characters', () => {
        expect(escapeCosmosDBShellStringLiteral('plain')).toBe('plain');
        expect(escapeCosmosDBShellStringLiteral('a"b')).toBe('a\\"b');
        expect(escapeCosmosDBShellStringLiteral('a\\b')).toBe('a\\\\b');
        expect(escapeCosmosDBShellStringLiteral('a\nb')).toBe('a\\nb');
        expect(escapeCosmosDBShellStringLiteral('a\rb')).toBe('a\\rb');
        expect(escapeCosmosDBShellStringLiteral('a\tb')).toBe('a\\tb');
    });

    it('escapes `$` so CosmosDBShell cannot interpolate a variable or run a nested command', () => {
        // Verified against the real binary: `echo "$((help))"` executes the `help` command
        // even inside an intact, properly-quoted string. Escaping `$` as `\$` neutralizes it.
        expect(escapeCosmosDBShellStringLiteral('$name')).toBe('\\$name');
        expect(escapeCosmosDBShellStringLiteral('$((help))')).toBe('\\$((help))');
        expect(escapeCosmosDBShellStringLiteral('a$(echo injected)b')).toBe('a\\$(echo injected)b');
    });
});

describe('getGoToContainerCommand', () => {
    it('builds a plain path for database + container', () => {
        expect(getGoToContainerCommand(db('mydb'), container('mycon'))).toBe('cd "/mydb/mycon"');
    });

    it('builds a plain path for database only', () => {
        expect(getGoToContainerCommand(db('mydb'), undefined as unknown as ContainerDefinition)).toBe('cd "/mydb"');
    });

    it('returns undefined when there is no database', () => {
        expect(
            getGoToContainerCommand(
                undefined as unknown as DatabaseDefinition,
                undefined as unknown as ContainerDefinition,
            ),
        ).toBeUndefined();
    });

    it('neutralizes a container id attempting to inject a second statement via `;`', () => {
        const malicious = 'example"; echo "injected';
        const command = getGoToContainerCommand(db('mydb'), container(malicious));
        expect(command).toBe('cd "/mydb/example\\"; echo \\"injected"');
    });

    it('neutralizes a database id attempting to inject a second statement via a newline', () => {
        const malicious = 'mydb"\necho "injected';
        const command = getGoToContainerCommand(db(malicious), container('mycon'));
        expect(command).toBe('cd "/mydb\\"\\necho \\"injected/mycon"');
    });

    it('neutralizes a container id shaped as a nested command execution `$(...)`', () => {
        const malicious = '$((help))';
        const command = getGoToContainerCommand(db('mydb'), container(malicious));
        expect(command).toBe('cd "/mydb/\\$((help))"');
    });
});
