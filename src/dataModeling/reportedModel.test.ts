/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { resolveReportedModel } from './reportedModel';

const lm = vscode.lm as unknown as { selectChatModels?: () => Promise<unknown[]> };

function chatModel(id: string, family: string, name: string, vendor = 'copilot') {
    return { id, family, name, vendor };
}

describe('resolveReportedModel', () => {
    afterEach(() => {
        delete lm.selectChatModels;
    });

    it('returns undefined when no identifier was reported', async () => {
        lm.selectChatModels = vi.fn();
        await expect(resolveReportedModel(undefined)).resolves.toBeUndefined();
        await expect(resolveReportedModel('  -- ')).resolves.toBeUndefined();
        expect(lm.selectChatModels).not.toHaveBeenCalled();
    });

    it.each([
        ['gpt-4o', 'id'],
        ['GPT 4o', 'normalized id'],
        ['claude-opus-4.5', 'family'],
        ['Claude Opus 4.5', 'name'],
    ])('matches %s by %s and emits only vendor-published values', async (reported) => {
        lm.selectChatModels = vi.fn(async () => [
            chatModel('gpt-4o', 'gpt-4o', 'GPT-4o'),
            chatModel('claude-opus-4.5-2026', 'claude-opus-4.5', 'Claude Opus 4.5'),
        ]);
        const resolved = await resolveReportedModel(reported);
        expect(resolved?.telemetry).toMatchObject({ modelSource: 'matched', modelVendor: 'copilot' });
        expect(resolved?.displayName).toMatch(/^(GPT-4o|Claude Opus 4\.5)$/);
    });

    it('prefers the most specific field, then Copilot-hosted models', async () => {
        lm.selectChatModels = vi.fn(async () => [
            chatModel('other-gpt-4o', 'gpt-4o', 'GPT-4o', 'other'),
            chatModel('copilot-gpt-4o', 'gpt-4o', 'GPT-4o'),
        ]);
        await expect(resolveReportedModel('gpt-4o')).resolves.toEqual({
            telemetry: {
                modelSource: 'matched',
                modelId: 'copilot-gpt-4o',
                modelFamily: 'gpt-4o',
                modelVendor: 'copilot',
            },
            displayName: 'GPT-4o',
        });
        await expect(resolveReportedModel('other-gpt-4o')).resolves.toMatchObject({
            telemetry: { modelVendor: 'other' },
        });
    });

    it('keeps an unknown identifier for display only, never in the telemetry identity', async () => {
        lm.selectChatModels = vi.fn(async () => [chatModel('gpt-4o', 'gpt-4o', 'GPT-4o')]);
        await expect(resolveReportedModel('  PRIVATE model  ')).resolves.toEqual({
            telemetry: { modelSource: 'unmatched' },
            displayName: 'PRIVATE model',
        });
    });

    it('treats an unavailable model API as unmatched', async () => {
        await expect(resolveReportedModel('gpt-4o')).resolves.toMatchObject({
            telemetry: { modelSource: 'unmatched' },
        });
        lm.selectChatModels = vi.fn(async () => {
            throw new Error('PRIVATE ERROR');
        });
        await expect(resolveReportedModel('gpt-4o')).resolves.toMatchObject({
            telemetry: { modelSource: 'unmatched' },
        });
    });
});
