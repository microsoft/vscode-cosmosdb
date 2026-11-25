/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { openReadOnlyContent } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import * as vscode from 'vscode';
import { type DiagnosticsState } from './model';
import { renderJsonReport, renderReport } from './presentation';

type ReportActionResult = 'done' | 'cancelled' | 'unavailable' | 'failed';

export async function showDiagnosticsReport(state: DiagnosticsState): Promise<ReportActionResult> {
    if (state.phase === 'running') return 'unavailable';
    try {
        await openReadOnlyContent(
            {
                label: l10n.t('Connection Diagnostics'),
                fullId: `cosmosDiagnostics-${state.trace?.runId ?? randomUUID()}`,
            },
            renderReport(state),
            '.md',
        );
        return 'done';
    } catch {
        return 'failed';
    }
}

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
    try {
        const file = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.joinPath(
                vscode.workspace.workspaceFolders?.[0]?.uri ?? vscode.Uri.file(homedir()),
                'cosmos-db-connection-diagnostics.md',
            ),
            filters: { [l10n.t('Markdown')]: ['md'], [l10n.t('JSON')]: ['json'] },
            saveLabel: l10n.t('Save redacted report'),
        });
        if (!file) return 'cancelled';
        const report = file.path.toLowerCase().endsWith('.json') ? renderJsonReport(state) : renderReport(state);
        await vscode.workspace.fs.writeFile(file, new TextEncoder().encode(report));
        return 'done';
    } catch {
        return 'failed';
    }
}
