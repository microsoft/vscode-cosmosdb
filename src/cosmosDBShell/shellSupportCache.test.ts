/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as child from 'child_process';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { getCosmosDBShellCommand } from './shellCommand';
import {
    getDetectedCosmosDBShellVersion,
    invalidateCosmosDBShellSupportCache,
    isCosmosDBShellInstalled,
} from './shellSupportCache';

vi.mock('child_process', () => ({
    execFileSync: vi.fn(),
}));

vi.mock('./shellCommand', () => ({
    getCosmosDBShellCommand: vi.fn(),
}));

vi.mock('../extensionVariables', () => ({
    ext: {
        outputChannel: {
            appendLine: vi.fn(),
        },
    },
}));

describe('shellSupportCache', () => {
    beforeEach(() => {
        invalidateCosmosDBShellSupportCache();
        vi.clearAllMocks();
        (getCosmosDBShellCommand as Mock).mockReturnValue('cosmosdbshell');
    });

    it('marks the shell as installed and parses the version on a clean successful exit', () => {
        (child.execFileSync as Mock).mockReturnValue(Buffer.from('CosmosDBShell 1.2.3\n'));
        expect(isCosmosDBShellInstalled()).toBe(true);
        expect(getDetectedCosmosDBShellVersion()).toBe('1.2.3');
    });

    it('parses pre-release version tokens (e.g. 1.2.3-prerelease.4)', () => {
        (child.execFileSync as Mock).mockReturnValue(Buffer.from('CosmosDBShell 1.2.3-prerelease.4\n'));
        expect(getDetectedCosmosDBShellVersion()).toBe('1.2.3-prerelease.4');
    });

    it('returns installed=true with undefined version when no SemVer-like token is in the output', () => {
        (child.execFileSync as Mock).mockReturnValue(Buffer.from('no version info here\n'));
        expect(isCosmosDBShellInstalled()).toBe(true);
        expect(getDetectedCosmosDBShellVersion()).toBeUndefined();
    });

    it('caches the probe result across calls keyed on the resolved command', () => {
        (child.execFileSync as Mock).mockReturnValue(Buffer.from('1.0.0\n'));
        isCosmosDBShellInstalled();
        isCosmosDBShellInstalled();
        getDetectedCosmosDBShellVersion();
        expect((child.execFileSync as Mock).mock.calls).toHaveLength(1);
    });

    it('invalidate clears the cache so the next call re-probes', () => {
        (child.execFileSync as Mock).mockReturnValue(Buffer.from('1.0.0\n'));
        isCosmosDBShellInstalled();
        invalidateCosmosDBShellSupportCache();
        isCosmosDBShellInstalled();
        expect((child.execFileSync as Mock).mock.calls).toHaveLength(2);
    });

    it('uses a separate cache entry per resolved command path', () => {
        (child.execFileSync as Mock).mockReturnValue(Buffer.from('1.0.0\n'));

        (getCosmosDBShellCommand as Mock).mockReturnValue('cmd-a');
        isCosmosDBShellInstalled();

        (getCosmosDBShellCommand as Mock).mockReturnValue('cmd-b');
        isCosmosDBShellInstalled();

        expect((child.execFileSync as Mock).mock.calls).toHaveLength(2);
    });

    it('treats non-zero exit with recognizable shell output as installed (ANSI fallback)', () => {
        const err = Object.assign(new Error('Spawn failed'), {
            stdout: Buffer.from('CosmosDBShell 2.0.0-rc.1\n'),
            stderr: Buffer.from('ansi: terminal not supported'),
        });
        (child.execFileSync as Mock).mockImplementation(() => {
            throw err;
        });

        expect(isCosmosDBShellInstalled()).toBe(true);
        expect(getDetectedCosmosDBShellVersion()).toBe('2.0.0-rc.1');
    });

    it('handles string-typed stdout/stderr on the error object (not only Buffers)', () => {
        const err = Object.assign(new Error('Spawn failed'), {
            stdout: 'CosmosDBShell 3.0.0\n',
            stderr: '',
        });
        (child.execFileSync as Mock).mockImplementation(() => {
            throw err;
        });

        expect(isCosmosDBShellInstalled()).toBe(true);
        expect(getDetectedCosmosDBShellVersion()).toBe('3.0.0');
    });

    it('treats non-zero exit with no recognizable output as not installed', () => {
        const err = Object.assign(new Error('spawn ENOENT'), {
            stdout: '',
            stderr: '',
        });
        (child.execFileSync as Mock).mockImplementation(() => {
            throw err;
        });

        expect(isCosmosDBShellInstalled()).toBe(false);
        expect(getDetectedCosmosDBShellVersion()).toBeUndefined();
    });

    it('treats a thrown error with no stdout/stderr at all as not installed', () => {
        (child.execFileSync as Mock).mockImplementation(() => {
            throw new Error('boom');
        });
        expect(isCosmosDBShellInstalled()).toBe(false);
    });
});
