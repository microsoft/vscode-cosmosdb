/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryEditorContext, QueryEditorStateDispatchContext } from '../state/QueryEditorContext';
import { defaultState, type DispatchAction, type QueryEditorState } from '../state/QueryEditorState';
import { GenerateQueryInput } from './GenerateQueryInput';

// A configurable fake tRPC client shared between the module mock and the assertions. Each procedure
// used by the component is a `vi.fn()` so individual tests can inspect/override call behavior.
const trpc = vi.hoisted(() => {
    const procedure = () => ({ query: vi.fn(), mutate: vi.fn() });
    return {
        queryEditor: {
            getAvailableModels: procedure(),
            setSelectedModel: procedure(),
            closeGenerateInput: procedure(),
            generateQuery: procedure(),
            cancelGenerateQuery: procedure(),
            confirmToolInvocationResponse: procedure(),
            reportFeedback: procedure(),
            updateQueryText: procedure(),
        },
    };
});

vi.mock('@cosmosdb/webview-rpc/react', () => ({
    useTrpcClient: () => ({
        trpcClient: trpc,
        // The component never subscribes to events directly, but the hook contract returns one.
        events: { onError: () => () => {} },
    }),
}));

function renderInput(stateOverrides: Partial<QueryEditorState> = {}) {
    const dispatch = vi.fn<(action: DispatchAction) => void>();
    const state: QueryEditorState = { ...defaultState, showGenerateInput: true, ...stateOverrides };

    const Wrapper = ({ children }: { children: ReactNode }) => (
        <FluentProvider theme={webLightTheme}>
            <QueryEditorContext.Provider value={state}>
                <QueryEditorStateDispatchContext.Provider value={dispatch}>
                    {children}
                </QueryEditorStateDispatchContext.Provider>
            </QueryEditorContext.Provider>
        </FluentProvider>
    );

    const result = render(<GenerateQueryInput />, { wrapper: Wrapper });
    return { ...result, dispatch };
}

describe('GenerateQueryInput', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        trpc.queryEditor.getAvailableModels.query.mockResolvedValue({ models: [], savedModelId: undefined });
        trpc.queryEditor.generateQuery.mutate.mockResolvedValue({ generatedQuery: 'SELECT * FROM c' });
    });

    it('renders the prompt textarea when showGenerateInput is true', async () => {
        renderInput();

        const textarea = await screen.findByRole('textbox', {
            name: 'Describe your query in natural language',
        });
        expect(textarea).toBeInTheDocument();
    });

    it('renders nothing when showGenerateInput is false', () => {
        renderInput({ showGenerateInput: false });
        expect(
            screen.queryByRole('textbox', { name: 'Describe your query in natural language' }),
        ).not.toBeInTheDocument();
    });

    it('requests the available models when shown', async () => {
        renderInput();
        await waitFor(() => {
            expect(trpc.queryEditor.getAvailableModels.query).toHaveBeenCalledTimes(1);
        });
    });

    it('submits the prompt with the current query on Enter', async () => {
        const user = userEvent.setup();
        renderInput({ queryValue: 'SELECT 1' });

        const textarea = await screen.findByRole('textbox', {
            name: 'Describe your query in natural language',
        });
        await user.type(textarea, 'find all docs');
        await user.keyboard('{Enter}');

        await waitFor(() => {
            expect(trpc.queryEditor.generateQuery.mutate).toHaveBeenCalledWith({
                prompt: 'find all docs',
                currentQuery: 'SELECT 1',
            });
        });
    });

    it('does not submit when the prompt is empty', async () => {
        const user = userEvent.setup();
        renderInput();

        const textarea = await screen.findByRole('textbox', {
            name: 'Describe your query in natural language',
        });
        await user.click(textarea);
        await user.keyboard('{Enter}');

        expect(trpc.queryEditor.generateQuery.mutate).not.toHaveBeenCalled();
    });

    it('closes the input and notifies the extension when the close button is clicked', async () => {
        const user = userEvent.setup();
        const { dispatch } = renderInput();

        const closeButton = await screen.findByRole('button', { name: 'Close' });
        await user.click(closeButton);

        expect(trpc.queryEditor.closeGenerateInput.mutate).toHaveBeenCalledWith({
            hadEnteredPrompt: false,
            hadExecutedGenerateQuery: false,
        });
        expect(dispatch).toHaveBeenCalledWith({ type: 'toggleGenerateInput' });
    });

    describe('submit button enable/disable', () => {
        it('is disabled when the prompt is empty', async () => {
            renderInput();

            const submitButton = await screen.findByRole('button', { name: 'Generate query' });
            expect(submitButton).toBeDisabled();
        });

        it('is enabled when the prompt has text', async () => {
            const user = userEvent.setup();
            renderInput();

            const textarea = await screen.findByRole('textbox', {
                name: 'Describe your query in natural language',
            });
            await user.type(textarea, 'find all docs');

            const submitButton = screen.getByRole('button', { name: 'Generate query' });
            expect(submitButton).toBeEnabled();
        });

        it('is disabled when the prompt contains only whitespace', async () => {
            const user = userEvent.setup();
            renderInput();

            const textarea = await screen.findByRole('textbox', {
                name: 'Describe your query in natural language',
            });
            await user.type(textarea, '   ');

            const submitButton = screen.getByRole('button', { name: 'Generate query' });
            expect(submitButton).toBeDisabled();
        });

        it('switches to Cancel button while loading', async () => {
            const user = userEvent.setup();
            // Make generateQuery hang so loading state persists
            trpc.queryEditor.generateQuery.mutate.mockReturnValue(new Promise(() => {}));
            renderInput();

            const textarea = await screen.findByRole('textbox', {
                name: 'Describe your query in natural language',
            });
            await user.type(textarea, 'test query');
            await user.keyboard('{Enter}');

            const cancelButton = await screen.findByRole('button', { name: 'Cancel generation' });
            expect(cancelButton).toBeEnabled();
        });
    });

    describe('feedback buttons (thumbs up/down)', () => {
        it('are not shown when isSurveyCandidate is false', async () => {
            renderInput({ isSurveyCandidate: false });

            await screen.findByRole('textbox', { name: 'Describe your query in natural language' });
            expect(screen.queryByRole('button', { name: 'Like this response' })).not.toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'Dislike this response' })).not.toBeInTheDocument();
        });

        it('are shown and enabled when isSurveyCandidate is true', async () => {
            renderInput({ isSurveyCandidate: true });

            const thumbUp = await screen.findByRole('button', { name: 'Like this response' });
            const thumbDown = screen.getByRole('button', { name: 'Dislike this response' });
            expect(thumbUp).toBeEnabled();
            expect(thumbDown).toBeEnabled();
        });

        it('become disabled after clicking thumbs up', async () => {
            const user = userEvent.setup();
            renderInput({ isSurveyCandidate: true });

            const thumbUp = await screen.findByRole('button', { name: 'Like this response' });
            await user.click(thumbUp);

            expect(thumbUp).toBeDisabled();
            expect(screen.getByRole('button', { name: 'Dislike this response' })).toBeDisabled();
            expect(trpc.queryEditor.reportFeedback.mutate).toHaveBeenCalledWith({
                feedbackValue: 'up',
                component: 'generateQueryInput',
            });
        });

        it('become disabled after clicking thumbs down', async () => {
            const user = userEvent.setup();
            renderInput({ isSurveyCandidate: true });

            const thumbDown = await screen.findByRole('button', { name: 'Dislike this response' });
            await user.click(thumbDown);

            expect(thumbDown).toBeDisabled();
            expect(screen.getByRole('button', { name: 'Like this response' })).toBeDisabled();
            expect(trpc.queryEditor.reportFeedback.mutate).toHaveBeenCalledWith({
                feedbackValue: 'down',
                component: 'generateQueryInput',
            });
        });

        it('are re-enabled after a new generation completes', async () => {
            const user = userEvent.setup();
            renderInput({ isSurveyCandidate: true });

            // Give thumbs up first
            const thumbUp = await screen.findByRole('button', { name: 'Like this response' });
            await user.click(thumbUp);
            expect(thumbUp).toBeDisabled();

            // Submit a new prompt — handleSend resets feedbackGiven to null
            const textarea = screen.getByRole('textbox', { name: 'Describe your query in natural language' });
            await user.type(textarea, 'new query');
            await user.keyboard('{Enter}');

            await waitFor(() => {
                expect(trpc.queryEditor.generateQuery.mutate).toHaveBeenCalled();
            });

            // After generation completes, feedback buttons should be enabled again
            await waitFor(() => {
                expect(screen.getByRole('button', { name: 'Like this response' })).toBeEnabled();
                expect(screen.getByRole('button', { name: 'Dislike this response' })).toBeEnabled();
            });
        });
    });
});
