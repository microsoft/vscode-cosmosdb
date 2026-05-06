/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import { resolveCosmosDBShellCommand } from './cosmosDBShellCommandResolver';

jest.mock('fs', () => ({
    existsSync: jest.fn(),
    readFileSync: jest.fn(),
    statSync: jest.fn(),
}));

describe('cosmosDBShellCommandResolver', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        configureMockFiles([]);
    });

    it('resolves a dotnet tool shim on Windows to the underlying executable', () => {
        const commandShimPath = 'C:\\Users\\test\\.dotnet\\tools\\cosmosdbshell.cmd';
        const resolvedExePath =
            'C:\\Users\\test\\.dotnet\\tools\\.store\\cosmosdbshell.win-x64\\1.0.0\\cosmosdbshell.win-x64\\1.0.0\\tools\\any\\win-x64\\CosmosDBShell.exe';

        configureMockFiles([commandShimPath, resolvedExePath]);
        (fs.readFileSync as jest.Mock).mockReturnValue(
            '@echo off\n"%~dp0.store\\cosmosdbshell.win-x64\\1.0.0\\cosmosdbshell.win-x64\\1.0.0\\tools\\any\\win-x64\\CosmosDBShell.exe" %*',
        );

        const resolvedCommand = resolveCosmosDBShellCommand(
            undefined,
            {
                PATH: 'C:\\Users\\test\\.dotnet\\tools',
                PATHEXT: '.COM;.EXE;.BAT;.CMD',
            },
            true,
        );

        expect(resolvedCommand).toBe(resolvedExePath);
    });

    it('returns the sanitized configured path when no PATH lookup is needed', () => {
        const configuredPath = 'C:\\tools\\CosmosDBShell.exe';
        configureMockFiles([configuredPath]);

        const resolvedCommand = resolveCosmosDBShellCommand(
            `"${configuredPath}"`,
            {
                PATH: '',
                PATHEXT: '.COM;.EXE;.BAT;.CMD',
            },
            true,
        );

        expect(resolvedCommand).toBe(configuredPath);
    });

    it('applies PATHEXT probing for explicit configured paths without an extension on Windows', () => {
        const configuredPath = 'C:\\tools\\CosmosDBShell';
        const executablePath = `${configuredPath}.exe`;
        configureMockFiles([executablePath]);

        const resolvedCommand = resolveCosmosDBShellCommand(
            configuredPath,
            {
                PATH: '',
                PATHEXT: '.COM;.EXE;.BAT;.CMD',
            },
            true,
        );

        expect(resolvedCommand).toBe(executablePath);
    });
});

function configureMockFiles(filePaths: string[]): void {
    const knownFiles = new Set(filePaths.map((filePath) => filePath.toLowerCase()));

    (fs.existsSync as jest.Mock).mockImplementation((candidatePath: string) =>
        knownFiles.has(candidatePath.toLowerCase()),
    );
    (fs.statSync as jest.Mock).mockImplementation((candidatePath: string) => ({
        isFile: () => knownFiles.has(candidatePath.toLowerCase()),
    }));
}
