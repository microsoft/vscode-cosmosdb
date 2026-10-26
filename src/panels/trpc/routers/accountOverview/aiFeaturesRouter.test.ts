/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { DATA_MODELER_ENABLED_SETTING } from '../../../../commands/dataModeling/dataModelerFeatureFlag';
import { ext } from '../../../../extensionVariables';
import { onCopilotAvailabilityChanged } from '../../../../utils/copilotUtils';
import { type AccountOverviewRouterContext } from '../../appRouter';
import { accountOverviewRouter } from '../../trpc';
import { aiFeaturesProcedures } from './aiFeaturesRouter';

vi.mock('../../../../extensionVariables', () => ({ ext: { isAIFeaturesEnabled: false } }));
vi.mock('../../../../utils/copilotUtils', () => ({ onCopilotAvailabilityChanged: vi.fn() }));
vi.mock('../../trpc', async () => {
    const { initWebviewTrpc } = await import('@microsoft/vscode-ext-webview');
    const trpc = initWebviewTrpc<AccountOverviewRouterContext>();
    return { accountOverviewProcedure: trpc.publicProcedure, accountOverviewRouter: trpc.router };
});

const router = accountOverviewRouter(aiFeaturesProcedures);
const dispose = vi.fn();
const cleanups: (() => Promise<void>)[] = [];
let onAvailabilityChanged: (enabled: boolean) => void;
let onConfigurationChanged: (event: vscode.ConfigurationChangeEvent) => void;
let modelerEnabled: boolean | undefined;
const disposeConfiguration = vi.fn();

beforeEach(() => {
    vi.resetAllMocks();
    ext.isAIFeaturesEnabled = false;
    modelerEnabled = undefined;
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
        get: vi.fn().mockImplementation((_key, fallback) => modelerEnabled ?? fallback),
        has: vi.fn(),
        inspect: vi.fn(),
        update: vi.fn(),
    });
    vi.mocked(vscode.workspace.onDidChangeConfiguration).mockImplementation((callback) => {
        onConfigurationChanged = callback;
        return { dispose: disposeConfiguration };
    });
    vi.mocked(onCopilotAvailabilityChanged).mockImplementation((callback) => {
        onAvailabilityChanged = callback;
        return { dispose };
    });
});

afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) {
        await cleanup();
    }
});

async function subscribe(
    controller = new AbortController(),
    procedure: 'aiFeaturesEnabled' | 'dataModelerEnabled' = 'aiFeaturesEnabled',
) {
    const caller = router.createCaller({
        webviewName: 'cosmosDbAccountOverview',
        metadata: {} as AccountOverviewRouterContext['metadata'],
        getInitialization: () => ({ type: 'navigate', target: 'overview', revision: 0 }),
        onNavigation: () => ({ dispose() {} }),
        signal: controller.signal,
    });
    const iterable = await caller[procedure]();
    const iterator = iterable[Symbol.asyncIterator]();
    cleanups.push(async () => {
        controller.abort();
        await iterator.return?.();
    });
    return { iterator, controller };
}

describe('Account Overview Data Modeler flag subscription', () => {
    it.each([true, false, undefined])('starts with flag %s (unset defaults to enabled)', async (enabled) => {
        modelerEnabled = enabled;
        const { iterator } = await subscribe(new AbortController(), 'dataModelerEnabled');
        await expect(iterator.next()).resolves.toEqual({ done: false, value: enabled ?? true });
        expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith('cosmosDB');
    });

    it('delivers live flag changes and ignores unrelated settings', async () => {
        const { iterator } = await subscribe(new AbortController(), 'dataModelerEnabled');
        await iterator.next();
        onConfigurationChanged({ affectsConfiguration: () => false });
        for (const enabled of [false, true, false]) {
            modelerEnabled = enabled;
            const pending = iterator.next();
            onConfigurationChanged({ affectsConfiguration: (key) => key === DATA_MODELER_ENABLED_SETTING });
            await expect(pending).resolves.toEqual({ done: false, value: enabled });
        }
        await iterator.return?.();
        expect(disposeConfiguration).toHaveBeenCalledOnce();
    });

    it('aborts an idle subscription and disposes its configuration listener', async () => {
        const { iterator, controller } = await subscribe(new AbortController(), 'dataModelerEnabled');
        await iterator.next();
        const pending = iterator.next();
        controller.abort();
        await expect(pending).resolves.toEqual({ done: true, value: undefined });
        expect(disposeConfiguration).toHaveBeenCalledOnce();
    });
});

describe('Account Overview AI availability subscription', () => {
    it.each([true, false, undefined])('starts with shared AI availability %s', async (enabled) => {
        ext.isAIFeaturesEnabled = enabled;
        const { iterator } = await subscribe();
        await expect(iterator.next()).resolves.toEqual({ done: false, value: enabled ?? false });
    });

    it('delivers live availability changes in order', async () => {
        const { iterator } = await subscribe();
        await iterator.next();
        for (const enabled of [true, false, true]) {
            const pending = iterator.next();
            onAvailabilityChanged(enabled);
            await expect(pending).resolves.toEqual({ done: false, value: enabled });
        }
    });

    it('releases the availability listener when unsubscribed', async () => {
        const { iterator } = await subscribe();
        await iterator.next();
        await iterator.return?.();
        expect(dispose).toHaveBeenCalledOnce();
    });

    it('aborts an idle subscription and releases the availability listener', async () => {
        const { iterator, controller } = await subscribe();
        await iterator.next();
        const pending = iterator.next();
        controller.abort();
        await expect(pending).resolves.toEqual({ done: true, value: undefined });
        expect(dispose).toHaveBeenCalledOnce();
    });

    it('does not yield availability when already aborted', async () => {
        const controller = new AbortController();
        controller.abort();
        const { iterator } = await subscribe(controller);
        await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
        expect(dispose).toHaveBeenCalledOnce();
    });
});
