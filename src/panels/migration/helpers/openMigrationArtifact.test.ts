/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { openMigrationArtifact } from './openMigrationArtifact';

function property(name: string, line: number, children: vscode.DocumentSymbol[] = []): vscode.DocumentSymbol {
    const selection = new vscode.Range(line, 4, line, 4 + name.length + 2);
    const symbol = new vscode.DocumentSymbol(name, '', vscode.SymbolKind.Property, selection, selection);
    symbol.children = children;
    return symbol;
}

describe('opening migration artifacts', () => {
    beforeEach(() => {
        vi.mocked(vscode.commands.executeCommand).mockReset();
        vi.spyOn(vscode.window, 'showTextDocument').mockImplementation(vi.fn());
    });
    afterEach(() => vi.restoreAllMocks());

    it('opens ordinary artifacts without requesting document symbols', async () => {
        await openMigrationArtifact('/workspace/.cosmosdb-migration/phases/4-provisioning/main.bicep');
        expect(vscode.window.showTextDocument).toHaveBeenCalledWith(
            vscode.Uri.file('/workspace/.cosmosdb-migration/phases/4-provisioning/main.bicep'),
            { preview: true },
        );
        expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
    });

    it('selects the exact nested JSON property rather than another property with the same name', async () => {
        const completedAt = property('completedAt', 120);
        vi.mocked(vscode.commands.executeCommand).mockResolvedValue([
            property('completedAt', 1),
            property('phases', 2, [
                property('assessment', 3, [property('completedAt', 4)]),
                property('provisioning', 100, [completedAt]),
            ]),
        ]);
        await openMigrationArtifact('/workspace/.cosmosdb-migration/project.json#phases.provisioning.completedAt');
        const uri = vscode.Uri.file('/workspace/.cosmosdb-migration/project.json');
        expect(vscode.commands.executeCommand).toHaveBeenCalledWith('vscode.executeDocumentSymbolProvider', uri);
        expect(vscode.window.showTextDocument).toHaveBeenCalledWith(uri, {
            preview: true,
            selection: completedAt.selectionRange,
        });
    });

    it.each([
        { symbols: undefined },
        { symbols: [] },
        { symbols: [property('phases', 2, [property('provisioning', 3)])] },
    ])('reports unresolved properties instead of opening the wrong location (%j)', async ({ symbols }) => {
        vi.mocked(vscode.commands.executeCommand).mockResolvedValue(symbols);
        await expect(openMigrationArtifact('/workspace/project.json#phases.provisioning.completedAt')).rejects.toThrow(
            'Could not locate JSON property "phases.provisioning.completedAt".',
        );
        expect(vscode.window.showTextDocument).not.toHaveBeenCalled();
    });

    it('propagates document-symbol provider errors', async () => {
        vi.mocked(vscode.commands.executeCommand).mockRejectedValue(new Error('Provider unavailable'));
        await expect(openMigrationArtifact('/workspace/project.json#phases')).rejects.toThrow('Provider unavailable');
        expect(vscode.window.showTextDocument).not.toHaveBeenCalled();
    });
});
