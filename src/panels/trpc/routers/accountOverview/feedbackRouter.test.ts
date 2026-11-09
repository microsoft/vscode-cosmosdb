/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import { env, Uri, workspace, type ConfigurationChangeEvent } from 'vscode';
import type * as surveyModule from '../../../../utils/survey';
import { getIsSurveyDisabledGlobally, openSurvey, promptAfterActionEventually } from '../../../../utils/survey';
import { ExperienceKind } from '../../../../utils/surveyTypes';
import { type AccountOverviewRouterContext } from '../../appRouter';
import { accountOverviewRouter } from '../../trpc';
import { feedbackProcedures } from './feedbackRouter';

vi.mock('../../../../utils/survey', async (importOriginal) => {
    const survey = await importOriginal<typeof surveyModule>();
    return {
        ...survey,
        getIsSurveyDisabledGlobally: vi.fn(survey.getIsSurveyDisabledGlobally),
        openSurvey: vi.fn(survey.openSurvey),
        promptAfterActionEventually: vi.fn(),
    };
});
vi.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: vi.fn(
        async (
            _eventName: string,
            callback: (context: Pick<IActionContext, 'telemetry' | 'errorHandling'>) => void | Promise<void>,
        ) => {
            const context: Pick<IActionContext, 'telemetry' | 'errorHandling'> = {
                telemetry: { properties: {}, measurements: {} },
                errorHandling: { issueProperties: {} },
            };
            try {
                await callback(context);
            } catch (error) {
                if (context.errorHandling.rethrow) {
                    throw error;
                }
            }
        },
    ),
}));
vi.mock('../../../../extensionVariables', () => ({ ext: {} }));
vi.mock('vscode', async (importOriginal) => ({
    ...(await importOriginal<typeof vscode>()),
    env: { openExternal: vi.fn() },
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
    vi.mocked(env.openExternal).mockResolvedValue(true);
    vi.spyOn(workspace, 'getConfiguration').mockReturnValue({
        get: vi.fn().mockReturnValue(true),
        has: vi.fn(),
        inspect: vi.fn(),
        update: vi.fn(),
    });
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
        expect(env.openExternal).toHaveBeenCalledExactlyOnceWith(Uri.parse('https://aka.ms/AzureDatabasesSurvey'));
    });

    it('rejects the mutation when the browser refuses to open the survey', async () => {
        vi.mocked(env.openExternal).mockResolvedValue(false);
        await expect(createCaller().provideFeedback()).rejects.toThrow('Unable to open the link in your browser.');
    });

    it('propagates a rejected browser launch through the mutation', async () => {
        const error = new Error('Browser launch failed');
        const launch = Promise.reject(error);
        // The old fire-and-forget implementation must fail the assertion without an unhandled test rejection.
        void launch.catch(() => {});
        vi.mocked(env.openExternal).mockReturnValue(launch);
        await expect(createCaller().provideFeedback()).rejects.toThrow(error.message);
    });

    it('waits for the browser launch before resolving the mutation', async () => {
        const launch = Promise.withResolvers<boolean>();
        vi.mocked(env.openExternal).mockReturnValue(launch.promise);
        const completed = vi.fn();
        const result = createCaller().provideFeedback().then(completed);
        try {
            await vi.waitFor(() => expect(env.openExternal).toHaveBeenCalledOnce());
            expect(completed).not.toHaveBeenCalled();
        } finally {
            launch.resolve(true);
            await result;
        }
        expect(completed).toHaveBeenCalledOnce();
    });

    it('does not launch the browser when feedback is disabled', async () => {
        vi.mocked(workspace.getConfiguration().get).mockReturnValue(false);
        await createCaller().provideFeedback();
        expect(env.openExternal).not.toHaveBeenCalled();
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
