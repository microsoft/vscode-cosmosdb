/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { SettingsService } from '../services/SettingsService';
import { isCosmosDBShellPathFound, quoteArg } from './shellCommand';

vi.mock('fs', () => ({
    existsSync: vi.fn(),
    statSync: vi.fn(),
}));

vi.mock('../services/SettingsService', () => ({
    SettingsService: {
        getSetting: vi.fn(),
    },
}));

vi.mock('../extensionVariables', () => ({
    ext: {
        outputChannel: {
            appendLine: vi.fn(),
            error: vi.fn(),
        },
    },
}));

describe('shellCommand.quoteArg', () => {
    it('returns the value unchanged when no whitespace or quotes are present', () => {
        expect(quoteArg('foo')).toBe('foo');
        expect(quoteArg('connect')).toBe('connect');
    });

    it('wraps values containing spaces in double quotes', () => {
        expect(quoteArg('foo bar')).toBe('"foo bar"');
        expect(quoteArg('https://my account.documents.azure.com/')).toBe('"https://my account.documents.azure.com/"');
    });

    it('wraps and escapes embedded double quotes', () => {
        expect(quoteArg('he said "hi"')).toBe('"he said \\"hi\\""');
    });

    it('wraps values containing single quotes', () => {
        expect(quoteArg("don't")).toBe('"don\'t"');
    });

    it('does not strip leading or trailing whitespace', () => {
        expect(quoteArg(' foo ')).toBe('" foo "');
    });
});

describe('shellCommand.isCosmosDBShellPathFound', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (fs.existsSync as Mock).mockReturnValue(false);
        (fs.statSync as Mock).mockReturnValue({ isFile: () => false });
    });

    it('returns false when no path is configured', () => {
        (SettingsService.getSetting as Mock).mockReturnValue(undefined);
        expect(isCosmosDBShellPathFound()).toBe(false);
    });

    it('returns false when the configured path is whitespace only', () => {
        (SettingsService.getSetting as Mock).mockReturnValue('   ');
        expect(isCosmosDBShellPathFound()).toBe(false);
    });

    it('strips wrapping double quotes before checking the filesystem', () => {
        const path = 'C:\\tools\\shell.exe';
        (SettingsService.getSetting as Mock).mockReturnValue(`"${path}"`);
        (fs.existsSync as Mock).mockImplementation((p: string) => p === path);
        (fs.statSync as Mock).mockReturnValue({ isFile: () => true });

        expect(isCosmosDBShellPathFound()).toBe(true);
    });

    it('strips wrapping single quotes before checking the filesystem', () => {
        const path = '/usr/local/bin/cosmosdbshell';
        (SettingsService.getSetting as Mock).mockReturnValue(`'${path}'`);
        (fs.existsSync as Mock).mockImplementation((p: string) => p === path);
        (fs.statSync as Mock).mockReturnValue({ isFile: () => true });

        expect(isCosmosDBShellPathFound()).toBe(true);
    });

    it('returns false when the configured path does not exist on disk', () => {
        (SettingsService.getSetting as Mock).mockReturnValue('C:\\does\\not\\exist.exe');
        (fs.existsSync as Mock).mockReturnValue(false);

        expect(isCosmosDBShellPathFound()).toBe(false);
    });

    it('returns false when the configured path resolves to a directory', () => {
        (SettingsService.getSetting as Mock).mockReturnValue('/usr/bin');
        (fs.existsSync as Mock).mockReturnValue(true);
        (fs.statSync as Mock).mockReturnValue({ isFile: () => false });

        expect(isCosmosDBShellPathFound()).toBe(false);
    });

    it('returns false when statSync throws (e.g. permission denied)', () => {
        (SettingsService.getSetting as Mock).mockReturnValue('/no/access');
        (fs.existsSync as Mock).mockReturnValue(true);
        (fs.statSync as Mock).mockImplementation(() => {
            throw new Error('EACCES');
        });

        expect(isCosmosDBShellPathFound()).toBe(false);
    });
});
