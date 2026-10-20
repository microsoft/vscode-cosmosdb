/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

beforeEach(() => {
    vi.resetAllMocks();
    ext.isAIFeaturesEnabled = false;
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

async function subscribe(controller = new AbortController()) {
    const iterable = await router
        .createCaller({
            webviewName: 'cosmosDbAccountOverview',
            metadata: {} as AccountOverviewRouterContext['metadata'],
            getInitialization: () => ({ type: 'navigate', target: 'overview', revision: 0 }),
            onNavigation: () => ({ dispose() {} }),
            signal: controller.signal,
        })
        .aiFeaturesEnabled();
    const iterator = iterable[Symbol.asyncIterator]();
    cleanups.push(async () => {
        controller.abort();
        await iterator.return?.();
    });
    return { iterator, controller };
}

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
