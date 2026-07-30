/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { beforeEach, describe, expect, test, vi, type Mock } from 'vitest';
import * as vscode from 'vscode';
import {
    RECOMMENDATION_STATE_IMPRESSION_COUNT,
    RECOMMENDATION_STATE_LATER_UNTIL,
    RECOMMENDATION_STATE_SUPPRESSED,
} from '../constants';
import {
    getShellRecommendationTestConfig,
    getShellRecommendationTestState,
    recordCosmosShellEngagementAndMaybeRecommend,
} from './shellRecommendation';

const mocks = vi.hoisted(() => ({
    globalState: new Map<string, unknown>(),
    installed: false,
    recommendationEnabled: true,
    telemetryEvents: [] as string[],
}));

vi.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: vi.fn(
        async (eventName: string, callback: (context: IActionContext) => unknown) => {
            mocks.telemetryEvents.push(eventName);
            return callback({
                telemetry: { properties: {}, measurements: {} },
                errorHandling: { issueProperties: {} },
                valuesToMask: [],
            } as unknown as IActionContext);
        },
    ),
}));

vi.mock('@vscode/l10n', () => ({
    t: (message: string) => message,
}));

vi.mock('vscode', () => ({
    commands: {
        executeCommand: vi.fn(() => Promise.resolve()),
    },
    env: {
        openExternal: vi.fn(() => Promise.resolve(true)),
    },
    Uri: {
        parse: vi.fn((value: string) => ({ value })),
    },
    window: {
        showInformationMessage: vi.fn(() => Promise.resolve(undefined)),
    },
}));

vi.mock('../../extensionVariables', () => ({
    ext: {
        context: {
            globalState: {
                get: vi.fn((key: string, defaultValue?: unknown) => mocks.globalState.get(key) ?? defaultValue),
                update: vi.fn((key: string, value: unknown) => {
                    mocks.globalState.set(key, value);
                    return Promise.resolve();
                }),
            },
        },
    },
}));

vi.mock('../../services/SettingsService', () => ({
    SettingsService: {
        getSetting: vi.fn(() => mocks.recommendationEnabled),
    },
}));

vi.mock('../shellSupportCache', () => ({
    isCosmosDBShellInstalled: vi.fn(() => mocks.installed),
}));

describe('Cosmos DB Shell recommendation', () => {
    const state = getShellRecommendationTestState()!;
    const config = getShellRecommendationTestConfig()!;

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.globalState.clear();
        mocks.telemetryEvents.length = 0;
        mocks.installed = false;
        mocks.recommendationEnabled = true;
        state.actionCount = 0;
        state.wasShownInSession = false;
        (vscode.window.showInformationMessage as Mock).mockResolvedValue(undefined);
    });

    test('shows only after the configured number of engagement signals', async () => {
        await recordCosmosShellEngagementAndMaybeRecommend('openDocument');
        expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();

        await recordCosmosShellEngagementAndMaybeRecommend('runQuery');
        expect(vscode.window.showInformationMessage).toHaveBeenCalledOnce();
        expect(mocks.globalState.get(RECOMMENDATION_STATE_IMPRESSION_COUNT)).toBe(1);
    });

    test('does not show when the Shell is installed or the setting is disabled', async () => {
        mocks.installed = true;
        await recordCosmosShellEngagementAndMaybeRecommend('openDocument');
        await recordCosmosShellEngagementAndMaybeRecommend('runQuery');

        mocks.installed = false;
        mocks.recommendationEnabled = false;
        await recordCosmosShellEngagementAndMaybeRecommend('openDocument');
        await recordCosmosShellEngagementAndMaybeRecommend('runQuery');

        expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
    });

    test('respects permanent suppression and the Later cooldown', async () => {
        mocks.globalState.set(RECOMMENDATION_STATE_SUPPRESSED, true);
        await recordCosmosShellEngagementAndMaybeRecommend('openDocument');
        await recordCosmosShellEngagementAndMaybeRecommend('runQuery');

        mocks.globalState.delete(RECOMMENDATION_STATE_SUPPRESSED);
        mocks.globalState.set(RECOMMENDATION_STATE_LATER_UNTIL, new Date(Date.now() + 60_000).toISOString());
        await recordCosmosShellEngagementAndMaybeRecommend('openDocument');
        await recordCosmosShellEngagementAndMaybeRecommend('runQuery');

        expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
    });

    test('auto-suppresses at the lifetime cap without emitting a shown event', async () => {
        mocks.globalState.set(RECOMMENDATION_STATE_IMPRESSION_COUNT, config.LIFETIME_IMPRESSION_CAP);

        await recordCosmosShellEngagementAndMaybeRecommend('openDocument');
        await recordCosmosShellEngagementAndMaybeRecommend('runQuery');

        expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
        expect(mocks.globalState.get(RECOMMENDATION_STATE_SUPPRESSED)).toBe(true);
        expect(mocks.telemetryEvents).not.toContain('cosmosDB.cosmosDBShell.recommendation.shown');
    });

    test('claims the prompt before asynchronous work to prevent concurrent duplicates', async () => {
        await Promise.all([
            recordCosmosShellEngagementAndMaybeRecommend('openDocument'),
            recordCosmosShellEngagementAndMaybeRecommend('runQuery'),
            recordCosmosShellEngagementAndMaybeRecommend('openDocument'),
        ]);

        expect(vscode.window.showInformationMessage).toHaveBeenCalledOnce();
    });

    test('records Later cooldown and emits clicked telemetry only for an explicit action', async () => {
        (vscode.window.showInformationMessage as Mock).mockResolvedValue('Later');

        await recordCosmosShellEngagementAndMaybeRecommend('openDocument');
        await recordCosmosShellEngagementAndMaybeRecommend('runQuery');

        expect(mocks.globalState.get(RECOMMENDATION_STATE_LATER_UNTIL)).toEqual(expect.any(String));
        expect(mocks.globalState.get(RECOMMENDATION_STATE_IMPRESSION_COUNT)).toBe(0);
        expect(mocks.telemetryEvents).toContain('cosmosDB.cosmosDBShell.recommendation.clicked');
    });

    test('does not report a click when the notification is dismissed', async () => {
        await recordCosmosShellEngagementAndMaybeRecommend('openDocument');
        await recordCosmosShellEngagementAndMaybeRecommend('runQuery');

        expect(mocks.telemetryEvents).toContain('cosmosDB.cosmosDBShell.recommendation.shown');
        expect(mocks.telemetryEvents).not.toContain('cosmosDB.cosmosDBShell.recommendation.clicked');
    });
});
