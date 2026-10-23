/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { workspace, type ConfigurationChangeEvent } from 'vscode';
import { getIsSurveyDisabledGlobally, openSurvey, promptAfterActionEventually } from '../../../../utils/survey';
import { ExperienceKind } from '../../../../utils/surveyTypes';
import { type AccountOverviewRouterContext } from '../../appRouter';
import { accountOverviewRouter } from '../../trpc';
import { feedbackProcedures } from './feedbackRouter';

vi.mock('../../../../utils/survey', () => ({
    getIsSurveyDisabledGlobally: vi.fn(),
    openSurvey: vi.fn(),
    promptAfterActionEventually: vi.fn(),
}));
vi.mock('../../trpc', async () => {
    const { initWebviewTrpc } = await import('@microsoft/vscode-ext-webview');
    const trpc = initWebviewTrpc<AccountOverviewRouterContext>();
    return { accountOverviewProcedure: trpc.publicProcedure, accountOverviewRouter: trpc.router };
});

const router = accountOverviewRouter(feedbackProcedures);
const dispose = vi.fn();
const cleanups: (() => Promise<void>)[] = [];
let onConfigurationChanged: (event: ConfigurationChangeEvent) => unknown;

function createCaller(signal?: AbortSignal) {
    return router.createCaller({
        webviewName: 'cosmosDbAccountOverview',
        metadata: {} as AccountOverviewRouterContext['metadata'],
        getInitialization: () => ({ type: 'navigate', target: 'overview', revision: 0 }),
        onNavigation: () => ({ dispose() {} }),
        signal,
    });
}

beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getIsSurveyDisabledGlobally).mockReturnValue(false);
    vi.spyOn(workspace, 'onDidChangeConfiguration').mockImplementation((listener) => {
        onConfigurationChanged = listener;
        return { dispose };
    });
});

afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) {
        await cleanup();
    }
    vi.restoreAllMocks();
});

async function subscribe(controller = new AbortController()) {
    const iterable = await createCaller(controller.signal).feedbackEnabled();
    const iterator = iterable[Symbol.asyncIterator]();
    cleanups.push(async () => {
        controller.abort();
        await iterator.return?.();
    });
    return { iterator, controller };
}

describe('Account Overview feedback', () => {
    it('opens the existing NoSQL survey with an Overview source without accumulating usage', async () => {
        await createCaller().provideFeedback();
        expect(openSurvey).toHaveBeenCalledExactlyOnceWith(
            ExperienceKind.NoSQL,
            'cosmosDB.accountOverview.provideFeedback',
        );
        expect(promptAfterActionEventually).not.toHaveBeenCalled();
    });

    it.each([true, false])(
        'initializes visibility from the global feedback preference (disabled: %s)',
        async (disabled) => {
            vi.mocked(getIsSurveyDisabledGlobally).mockReturnValue(disabled);
            const { iterator } = await subscribe();
            await expect(iterator.next()).resolves.toEqual({ done: false, value: !disabled });
            expect(promptAfterActionEventually).not.toHaveBeenCalled();
        },
    );

    it('delivers live preference changes, ignores unrelated settings and disposes on abort', async () => {
        const { iterator, controller } = await subscribe();
        await iterator.next();
        const pending = iterator.next();
        const unrelated = vi.fn(() => false);
        onConfigurationChanged({ affectsConfiguration: unrelated });
        expect(unrelated).toHaveBeenCalledWith('telemetry.feedback.enabled');
        vi.mocked(getIsSurveyDisabledGlobally).mockReturnValue(true);
        onConfigurationChanged({ affectsConfiguration: () => true });
        await expect(pending).resolves.toEqual({ done: false, value: false });
        const idle = iterator.next();
        controller.abort();
        await expect(idle).resolves.toEqual({ done: true, value: undefined });
        expect(dispose).toHaveBeenCalledOnce();
    });

    it('disposes its listener on unsubscribe and does not yield after an early abort', async () => {
        const { iterator } = await subscribe();
        await iterator.next();
        await iterator.return?.();
        expect(dispose).toHaveBeenCalledOnce();
        const controller = new AbortController();
        controller.abort();
        const aborted = await subscribe(controller);
        await expect(aborted.iterator.next()).resolves.toEqual({ done: true, value: undefined });
        expect(dispose).toHaveBeenCalledTimes(2);
    });
});
