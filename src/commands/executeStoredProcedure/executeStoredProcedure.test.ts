/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AzExtInputBoxOptions, type IActionContext } from '@microsoft/vscode-azext-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cosmosDBExecuteStoredProcedure } from './executeStoredProcedure';

const mocks = vi.hoisted(() => {
    const execute = vi.fn();
    const storedProcedure = vi.fn(() => ({ execute }));
    const container = vi.fn(() => ({ scripts: { storedProcedure } }));
    const database = vi.fn(() => ({ container }));
    return {
        execute,
        storedProcedure,
        container,
        database,
        client: { database },
        pick: vi.fn(),
        openReadOnlyJson: vi.fn(),
        withClaimsChallengeHandling: vi.fn(),
    };
});

vi.mock('@microsoft/vscode-azext-utils', () => ({
    openReadOnlyJson: mocks.openReadOnlyJson,
    parseError: (error: Error) => ({ message: error.message }),
}));
vi.mock('@microsoft/vscode-azureresources-api', () => ({
    AzExtResourceType: { AzureCosmosDb: 'AzureCosmosDb' },
}));
vi.mock('../../utils/pickItem/pickAppResource', () => ({ pickAppResource: mocks.pick }));
vi.mock('../../cosmosdb/withClaimsChallengeHandling', () => ({
    withClaimsChallengeHandling: mocks.withClaimsChallengeHandling,
}));

const validationMessage = 'Enter a valid JSON array, e.g. [1, {"key": "value"}], or leave empty for no parameters.';
const invalidInputs = ['["expected-value"', '[1,]', '[1, {key: value}]', '{}', '1', 'true', '"value"', 'null', '   '];
const showInputBox = vi.fn<(options: AzExtInputBoxOptions) => Promise<string>>();
const unexpectedPrompt = vi.fn(async (): Promise<never> => {
    throw new Error('Unexpected prompt');
});
const context: IActionContext = {
    ui: {
        onDidFinishPrompt: vi.fn(() => ({ dispose: vi.fn() })),
        showInputBox,
        showQuickPick: unexpectedPrompt,
        showWarningMessage: unexpectedPrompt,
        showOpenDialog: unexpectedPrompt,
        showWorkspaceFolderPick: unexpectedPrompt,
    },
    telemetry: { properties: {}, measurements: {} },
    errorHandling: { issueProperties: {} },
    valuesToMask: [],
};

beforeEach(() => {
    vi.clearAllMocks();
    showInputBox.mockReset();
    showInputBox.mockResolvedValueOnce('partition');
    mocks.pick.mockResolvedValue({
        model: {
            accountInfo: {},
            database: { id: 'database' },
            container: { id: 'container' },
            procedure: { id: 'procedure' },
        },
    });
    mocks.withClaimsChallengeHandling.mockImplementation(
        async (_account: unknown, callback: (client: typeof mocks.client) => Promise<unknown>) =>
            callback(mocks.client),
    );
    mocks.execute.mockResolvedValue({ resource: 'result' });
});

describe('cosmosDBExecuteStoredProcedure parameters', () => {
    it.each(invalidInputs)('rejects %j in the prompt without executing', async (input) => {
        const cancelled = new Error('Cancelled');
        showInputBox.mockImplementationOnce(async (options) => {
            expect(await options.validateInput?.(input)).toBe(validationMessage);
            expect(mocks.execute).not.toHaveBeenCalled();
            throw cancelled;
        });

        await expect(cosmosDBExecuteStoredProcedure(context)).rejects.toBe(cancelled);
        expect(mocks.withClaimsChallengeHandling).not.toHaveBeenCalled();
        expect(mocks.execute).not.toHaveBeenCalled();
        expect(mocks.openReadOnlyJson).not.toHaveBeenCalled();
    });

    it.each(invalidInputs)('blocks %j even if prompt validation is bypassed', async (input) => {
        showInputBox.mockResolvedValueOnce(input);

        await expect(cosmosDBExecuteStoredProcedure(context)).rejects.toThrow(validationMessage);
        expect(mocks.withClaimsChallengeHandling).not.toHaveBeenCalled();
        expect(mocks.execute).not.toHaveBeenCalled();
    });

    it.each([
        { input: '', parameters: undefined },
        { input: '[]', parameters: [] },
        { input: '[1, {"key": "value"}]', parameters: [1, { key: 'value' }] },
        { input: '[true, false, null, ["nested"]]', parameters: [true, false, null, ['nested']] },
        { input: ' \n [1] \t ', parameters: [1] },
    ])('accepts $input and passes the parameters unchanged', async ({ input, parameters }) => {
        showInputBox.mockImplementationOnce(async (options) => {
            expect(await options.validateInput?.(input)).toBeUndefined();
            return input;
        });

        await cosmosDBExecuteStoredProcedure(context);

        expect(mocks.database).toHaveBeenCalledWith('database');
        expect(mocks.container).toHaveBeenCalledWith('container');
        expect(mocks.storedProcedure).toHaveBeenCalledWith('procedure');
        expect(mocks.execute).toHaveBeenCalledExactlyOnceWith('partition', parameters);
        expect(mocks.openReadOnlyJson).toHaveBeenCalledOnce();
    });

    it('executes only with corrected parameters after an invalid entry', async () => {
        showInputBox.mockImplementationOnce(async (options) => {
            expect(await options.validateInput?.('[1,')).toBe(validationMessage);
            expect(mocks.execute).not.toHaveBeenCalled();
            expect(await options.validateInput?.('[2]')).toBeUndefined();
            return '[2]';
        });

        await cosmosDBExecuteStoredProcedure(context);

        expect(mocks.execute).toHaveBeenCalledExactlyOnceWith('partition', [2]);
    });
});
