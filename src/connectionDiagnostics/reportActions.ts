/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { homedir } from 'node:os';
import * as vscode from 'vscode';
import { type DiagnosticsState } from './model';
import { renderReport } from './presentation';

type ReportActionResult = 'done' | 'cancelled' | 'unavailable' | 'failed';

export async function copyDiagnosticsReport(state: DiagnosticsState): Promise<ReportActionResult> {
    if (state.phase === 'running') return 'unavailable';
    try {
        await vscode.env.clipboard.writeText(renderReport(state));
        return 'done';
    } catch {
        return 'failed';
    }
}

export async function saveDiagnosticsReport(state: DiagnosticsState): Promise<ReportActionResult> {
    if (state.phase === 'running') return 'unavailable';
    const report = renderReport(state);
    try {
        const file = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.joinPath(
                vscode.workspace.workspaceFolders?.[0]?.uri ?? vscode.Uri.file(homedir()),
                'cosmos-db-connection-diagnostics.txt',
            ),
            filters: { [l10n.t('Text files')]: ['txt'] },
            saveLabel: l10n.t('Save redacted report'),
        });
        if (!file) return 'cancelled';
        await vscode.workspace.fs.writeFile(file, new TextEncoder().encode(report));
        return 'done';
    } catch {
        return 'failed';
    }
}
