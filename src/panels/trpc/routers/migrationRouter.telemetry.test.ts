/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { TypedEventSink } from '@microsoft/vscode-ext-webview';
import { TelemetryContext } from '../../../Telemetry';
import { type MigrationRouterContext } from '../appRouter';
import { type MigrationEvent } from './migrationEventsRouter';
import { migrationRouterDef } from './migrationRouter';

const mocks = vi.hoisted(() => ({
    contexts: [] as Pick<IActionContext, 'telemetry' | 'valuesToMask' | 'errorHandling'>[],
    dispatch: vi.fn(),
}));
vi.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: vi.fn(
        async (_event: string, callback: (context: unknown) => Promise<unknown>) => {
            const context = {
                errorHandling: { issueProperties: {} },
                telemetry: { properties: {}, measurements: {} },
                valuesToMask: [],
            };
            mocks.contexts.push(context);
            return callback(context);
        },
    ),
}));
vi.mock('../../../extensionVariables', () => ({
    ext: { outputChannel: { debug: vi.fn(), warn: vi.fn() } },
}));

describe('migration application-details telemetry privacy', () => {
    let context: MigrationRouterContext;
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.contexts.length = 0;
        context = {
            webviewName: 'migration',
            telemetryContext: new TelemetryContext('migration'),
            panel: { title: 'Migration' } as MigrationRouterContext['panel'],
            eventSink: new TypedEventSink<MigrationEvent>(),
            dispatchCommand: mocks.dispatch,
        };
    });
    afterEach(() => context.eventSink.close());

    it.each([
        ['projectName', 'private-app'],
        ['projectType', 'private-type'],
        ['language', 'private-language'],
        ['frameworks', ['private-framework-a', 'private-framework-b']],
        ['databaseType', 'private-database'],
        ['databaseAccess', 'private-access'],
    ])('masks %s before dispatch can throw', async (field, value) => {
        mocks.dispatch.mockImplementationOnce(async () => {
            expect(mocks.contexts[0].valuesToMask).toEqual([value].flat());
            expect(mocks.contexts[0].telemetry.properties).toEqual({});
            throw new Error('Simulated save failure');
        });
        await expect(
            migrationRouterDef.createCaller(context).command({
                commandName: 'updateAnalysisResult',
                params: [{ [String(field)]: value }],
            }),
        ).rejects.toThrow('Simulated save failure');
        expect(mocks.dispatch).toHaveBeenCalledOnce();
    });

    it('keeps successful updates unchanged and creates independent per-invocation masks', async () => {
        mocks.dispatch.mockResolvedValue(undefined);
        const caller = migrationRouterDef.createCaller(context);
        await caller.command({ commandName: 'updateAnalysisResult', params: [{ projectName: 'first-app' }] });
        await caller.command({ commandName: 'updateAnalysisResult', params: [{ projectName: 'second-app' }] });
        expect(mocks.contexts[0].valuesToMask).toEqual(['first-app']);
        expect(mocks.contexts[1].valuesToMask).toEqual(['second-app']);
        expect(mocks.dispatch).toHaveBeenNthCalledWith(2, 'updateAnalysisResult', [{ projectName: 'second-app' }]);
    });
});
