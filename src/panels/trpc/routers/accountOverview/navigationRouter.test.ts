/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, describe, expect, it, vi } from 'vitest';
import { type AccountOverviewNavigation, type AccountOverviewTarget } from '../../../accountOverview/navigation';
import { type AccountOverviewRouterContext } from '../../appRouter';
import { accountOverviewRouter } from '../../trpc';
import { navigationProcedures } from './navigationRouter';

// Keep the real tRPC subscription and TypedEventSink; isolate only the unrelated observability middleware.
vi.mock('../../trpc', async () => {
    const { initWebviewTrpc } = await import('@microsoft/vscode-ext-webview');
    const trpc = initWebviewTrpc<AccountOverviewRouterContext>();
    return { accountOverviewProcedure: trpc.publicProcedure, accountOverviewRouter: trpc.router };
});

const router = accountOverviewRouter(navigationProcedures);
const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) {
        await cleanup();
    }
    vi.restoreAllMocks();
});

function createSource(target: AccountOverviewTarget = 'overview') {
    let initialization: AccountOverviewNavigation = { type: 'navigate', target, revision: 0 };
    const listeners = new Set<(navigation: AccountOverviewNavigation) => unknown>();
    const disposals: ReturnType<typeof vi.fn>[] = [];
    const onNavigation = vi.fn((listener: (navigation: AccountOverviewNavigation) => unknown) => {
        listeners.add(listener);
        const dispose = vi.fn(() => {
            listeners.delete(listener);
        });
        disposals.push(dispose);
        return { dispose };
    });
    const getInitialization = vi.fn(() => initialization);
    return {
        listeners,
        disposals,
        onNavigation,
        getInitialization,
        navigate(nextTarget: AccountOverviewTarget) {
            initialization = { type: 'navigate', target: nextTarget, revision: initialization.revision + 1 };
            for (const listener of listeners) {
                listener(initialization);
            }
            return initialization;
        },
    };
}

async function subscribe(source: ReturnType<typeof createSource>, controller = new AbortController()) {
    const context: AccountOverviewRouterContext = {
        webviewName: 'cosmosDbAccountOverview',
        metadata: {} as AccountOverviewRouterContext['metadata'],
        getInitialization: source.getInitialization,
        onNavigation: source.onNavigation,
        signal: controller.signal,
    };
    const iterable = await router.createCaller(context).navigation();
    const iterator = iterable[Symbol.asyncIterator]();
    cleanups.push(async () => {
        controller.abort();
        await iterator.return?.();
    });
    return { iterator, controller };
}

describe('account overview navigation subscription', () => {
    it.each(['overview', 'normalizedRu', 'advisories'] as const)(
        'starts with the current %s initialization',
        async (target) => {
            const source = createSource(target);
            const { iterator } = await subscribe(source);
            await expect(iterator.next()).resolves.toEqual({
                done: false,
                value: { type: 'navigate', target, revision: 0 },
            });
            expect(source.onNavigation).toHaveBeenCalledOnce();
            expect(source.getInitialization).toHaveBeenCalledOnce();
            expect(source.listeners.size).toBe(1);
        },
    );

    it('delivers only the latest snapshot for changes made before subscription starts', async () => {
        const source = createSource();
        source.navigate('totalRequests');
        const { iterator } = await subscribe(source);
        const latest = source.navigate('advisories');
        await expect(iterator.next()).resolves.toEqual({ done: false, value: latest });
        const next = source.navigate('overview');
        await expect(iterator.next()).resolves.toEqual({ done: false, value: next });
    });

    it('preserves repeated destinations and queued navigation revisions in order', async () => {
        const source = createSource();
        const { iterator } = await subscribe(source);
        await iterator.next();
        const navigations = [
            source.navigate('normalizedRu'),
            source.navigate('normalizedRu'),
            source.navigate('advisories'),
            source.navigate('overview'),
        ];
        for (const navigation of navigations) {
            await expect(iterator.next()).resolves.toEqual({ done: false, value: navigation });
        }
        expect(navigations.map((navigation) => navigation.revision)).toEqual([1, 2, 3, 4]);
    });

    it('wakes a waiting subscriber when navigation changes', async () => {
        const source = createSource();
        const { iterator } = await subscribe(source);
        await iterator.next();
        const pending = iterator.next();
        const navigation = source.navigate('documentCount');
        await expect(pending).resolves.toEqual({ done: false, value: navigation });
    });

    it('aborts an idle subscription and removes its event and abort listeners', async () => {
        const source = createSource();
        const controller = new AbortController();
        const addListener = vi.spyOn(controller.signal, 'addEventListener');
        const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
        const { iterator } = await subscribe(source, controller);
        await iterator.next();
        const pending = iterator.next();
        controller.abort();

        await expect(pending).resolves.toEqual({ done: true, value: undefined });
        expect(source.listeners.size).toBe(0);
        expect(source.disposals[0]).toHaveBeenCalledOnce();
        expect(addListener).toHaveBeenCalledWith('abort', expect.any(Function), { once: true });
        const close = addListener.mock.calls.find(([event]) => event === 'abort')![1];
        expect(removeListener).toHaveBeenCalledWith('abort', close);
        source.navigate('advisories');
        await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
    });

    it('does not deliver queued navigation after abort', async () => {
        const source = createSource();
        const { iterator, controller } = await subscribe(source);
        await iterator.next();
        source.navigate('normalizedRu');
        source.navigate('advisories');
        controller.abort();

        await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
        expect(source.listeners.size).toBe(0);
        expect(source.disposals[0]).toHaveBeenCalledOnce();
    });

    it('cleans up an already-aborted subscription without yielding initialization', async () => {
        const source = createSource();
        const controller = new AbortController();
        controller.abort();
        const { iterator } = await subscribe(source, controller);

        await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
        expect(source.listeners.size).toBe(0);
        expect(source.disposals[0]).toHaveBeenCalledOnce();
    });

    it('releases an explicitly unsubscribed iterator while the panel remains alive', async () => {
        const source = createSource();
        const { iterator, controller } = await subscribe(source);
        const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
        await iterator.next();
        await iterator.return?.();

        expect(controller.signal.aborted).toBe(false);
        expect(source.listeners.size).toBe(0);
        expect(source.disposals[0]).toHaveBeenCalledOnce();
        expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
        source.navigate('advisories');
        await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
    });

    it.each(['abort', 'unsubscribe'] as const)('re-subscribes with the latest snapshot after %s', async (stop) => {
        const source = createSource('normalizedRu');
        const first = await subscribe(source);
        await first.iterator.next();
        if (stop === 'abort') {
            const pending = first.iterator.next();
            first.controller.abort();
            await pending;
        } else {
            await first.iterator.return?.();
        }
        const latest = source.navigate('advisories');
        const second = await subscribe(source);

        await expect(second.iterator.next()).resolves.toEqual({ done: false, value: latest });
        const next = source.navigate('advisories');
        await expect(second.iterator.next()).resolves.toEqual({ done: false, value: next });
        expect(source.listeners.size).toBe(1);
        expect(source.onNavigation).toHaveBeenCalledTimes(2);
        expect(source.disposals[0]).toHaveBeenCalledOnce();
        expect(source.disposals[1]).not.toHaveBeenCalled();
    });

    it('gives simultaneous subscribers independent sinks and independent cleanup', async () => {
        const source = createSource();
        const first = await subscribe(source);
        const second = await subscribe(source);
        await first.iterator.next();
        await second.iterator.next();
        expect(source.listeners.size).toBe(2);
        const navigation = source.navigate('serverLatency');

        await expect(first.iterator.next()).resolves.toEqual({ done: false, value: navigation });
        await expect(second.iterator.next()).resolves.toEqual({ done: false, value: navigation });
        await first.iterator.return?.();
        const next = source.navigate('advisories');

        await expect(second.iterator.next()).resolves.toEqual({ done: false, value: next });
        expect(source.listeners.size).toBe(1);
        expect(source.disposals[0]).toHaveBeenCalledOnce();
        expect(source.disposals[1]).not.toHaveBeenCalled();
    });
});
