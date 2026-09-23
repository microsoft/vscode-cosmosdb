/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/** Telemetry-safe model identity. The raw self-reported string is never retained. */
export type ReportedModel =
    | { modelSource: 'matched'; modelId: string; modelFamily: string; modelVendor: string }
    | { modelSource: 'unmatched' };

export const NOT_REPORTED_MODEL = { modelSource: 'notReported' } as const;

/**
 * A resolved model report. `telemetry` is the only part that may be emitted. `displayName` is shown on the Result page
 * and saved with the result, but is never sent to telemetry because an unmatched name is free-form model output.
 */
export type ResolvedModel = { telemetry: ReportedModel; displayName: string };

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Resolves the model's self-reported identifier against the chat models published by VS Code, so only
 * vendor-published `modelId`, `modelFamily`, and `modelVendor` values can reach telemetry. Free-form or unknown
 * values collapse to `unmatched`. Returns `undefined` when nothing was reported; no file contents, paths, or names
 * are emitted.
 */
export async function resolveReportedModel(reported: string | undefined): Promise<ResolvedModel | undefined> {
    const key = reported ? normalize(reported) : '';
    if (!reported || !key) return undefined;
    const unmatched: ResolvedModel = { telemetry: { modelSource: 'unmatched' }, displayName: reported.trim() };
    let models: readonly vscode.LanguageModelChat[];
    try {
        models = await vscode.lm.selectChatModels();
    } catch {
        return unmatched;
    }
    // Prefer the most specific identifier, then Copilot-hosted models when several vendors share a family.
    for (const field of ['id', 'family', 'name'] as const) {
        const matches = models.filter((model) => typeof model[field] === 'string' && normalize(model[field]) === key);
        const match = matches.find((model) => model.vendor === 'copilot') ?? matches[0];
        if (match) {
            return {
                telemetry: {
                    modelSource: 'matched',
                    modelId: match.id,
                    modelFamily: match.family,
                    modelVendor: match.vendor,
                },
                displayName: match.name || match.id,
            };
        }
    }
    return unmatched;
}
