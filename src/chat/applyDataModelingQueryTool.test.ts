/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi } from 'vitest';
import packageJson from '../../package.json';
import {
    APPLY_DATA_MODELING_QUERY_TOOL_DESCRIPTION,
    APPLY_DATA_MODELING_QUERY_TOOL_INPUT_SCHEMA,
    registerApplyDataModelingQueryTool,
} from './applyDataModelingQueryTool';
import { invokeRegisteredTool } from './queryEditorToolTestUtils';

const { findById, deliver, emit, contexts } = vi.hoisted(() => ({
    findById: vi.fn(),
    deliver: vi.fn(),
    emit: vi.fn(),
    contexts: [] as { telemetry: { suppressAll?: boolean }; errorHandling: object }[],
}));
vi.mock('../panels/DataModelingWizardTab', () => ({ DataModelingWizardTab: { findById } }));
vi.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: async (_event: string, callback: (context: unknown) => unknown) => {
        const context = { telemetry: {}, errorHandling: {} };
        contexts.push(context);
        return callback(context);
    },
}));

const input = {
    wizardTabId: '12345678-1234-4123-8123-123456789001',
    requestId: '12345678-1234-4123-8123-123456789002',
    query: 'SELECT * FROM c WHERE c.customerId = @customerId',
};

beforeEach(() => {
    vi.clearAllMocks();
    contexts.length = 0;
    findById.mockReturnValue({ queryGeneration: { deliver }, eventSink: { emit } });
    deliver.mockImplementation((result, send) => {
        send(result);
        return Promise.resolve('applied');
    });
});

describe('apply Data Modeler query tool', () => {
    it('keeps the manifest and runtime contract in sync', () => {
        const manifest = packageJson.contributes.languageModelTools.find(
            (tool) => tool.name === 'cosmosdb_applyDataModelingQuery',
        );
        expect(manifest?.modelDescription).toBe(APPLY_DATA_MODELING_QUERY_TOOL_DESCRIPTION);
        expect(manifest?.inputSchema).toEqual(APPLY_DATA_MODELING_QUERY_TOOL_INPUT_SCHEMA);
    });

    it('normalizes SQL fences and delivers to the originating wizard without query telemetry', async () => {
        const { text } = await invokeRegisteredTool(registerApplyDataModelingQueryTool, {
            ...input,
            query: `\`\`\`sql\n${input.query}\n\`\`\``,
        });
        expect(findById).toHaveBeenCalledWith(input.wizardTabId);
        expect(emit).toHaveBeenCalledWith({ type: 'queryGenerated', requestId: input.requestId, query: input.query });
        expect(text).toContain('was applied');
        expect(text).toContain('not executed');
        expect(contexts[0].telemetry).toEqual({ suppressAll: true });
    });

    it.each(['', '   ', 'DELETE FROM c', 'SELECT FROM'])('rejects invalid query %j', async (query) => {
        const { text } = await invokeRegisteredTool(registerApplyDataModelingQueryTool, { ...input, query });
        expect(text).not.toContain('was applied');
        expect(deliver).not.toHaveBeenCalled();
    });

    it('reports explicit generation errors without replacing SQL', async () => {
        deliver.mockResolvedValue('error');
        const { text } = await invokeRegisteredTool(registerApplyDataModelingQueryTool, {
            wizardTabId: input.wizardTabId,
            requestId: input.requestId,
            error: 'Missing schema',
        });
        expect(text).toContain('No query was changed');
        expect(deliver).toHaveBeenCalledWith(
            { requestId: input.requestId, error: 'Missing schema' },
            expect.any(Function),
            expect.anything(),
        );
    });

    it('rejects ambiguous result shapes', async () => {
        await invokeRegisteredTool(registerApplyDataModelingQueryTool, { ...input, error: 'Cannot generate' });
        expect(deliver).not.toHaveBeenCalled();
    });

    it('does not fall back to another open wizard', async () => {
        findById.mockReturnValue(undefined);
        const { text } = await invokeRegisteredTool(registerApplyDataModelingQueryTool, input);
        expect(text).toContain('closed');
        expect(deliver).not.toHaveBeenCalled();
    });

    it('reports stale results instead of claiming success', async () => {
        deliver.mockResolvedValue('stale');
        const { text } = await invokeRegisteredTool(registerApplyDataModelingQueryTool, input);
        expect(text).toContain('No query was applied');
    });
});
