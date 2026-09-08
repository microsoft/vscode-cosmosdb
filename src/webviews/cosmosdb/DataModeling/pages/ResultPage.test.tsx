/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { type EditorProps } from '@monaco-editor/react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type PartitionKeyRecommendation } from '../../../api/types';
import { MonacoEditor } from '../../../MonacoEditor';
import { ResultPage } from './ResultPage';

vi.mock('../../../MonacoEditor', () => ({
    MonacoEditor: vi.fn(({ value, options }: EditorProps) => (
        <textarea aria-label={options?.ariaLabel} readOnly={options?.domReadOnly} value={value} />
    )),
}));

const recommendation: PartitionKeyRecommendation = {
    summary: '',
    containers: [
        { entity: 'Message', partitionKey: '/conversationId', rationale: '' },
        { entity: 'User', partitionKey: '/userId', rationale: '' },
    ],
};

function renderResult() {
    return render(
        <ResultPage recommendationStatus="received" recommendation={recommendation} onRetryRecommendation={vi.fn()} />,
    );
}

function editorProps() {
    return vi.mocked(MonacoEditor).mock.calls.at(-1)?.[0];
}

describe('ResultPage code samples', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders a named, read-only Bicep snippet without editor chrome or a keyboard trap', () => {
        renderResult();

        const editor = screen.getByRole('textbox', { name: 'Container creation code sample' });
        expect(editor).toHaveAttribute('readonly');
        expect(editorProps()).toMatchObject({
            language: 'bicep',
            value: expect.stringContaining("name: 'Message'"),
            options: {
                readOnly: true,
                domReadOnly: true,
                tabFocusMode: true,
                minimap: { enabled: false },
                lineNumbers: 'off',
                folding: false,
                scrollBeyondLastLine: false,
                wordWrap: 'off',
            },
        });
        expect(screen.getByRole('button', { name: 'Create Container' })).toHaveTextContent('Create Container');
        expect(screen.getByRole('tab', { name: 'Container: Message' })).toHaveTextContent('Container: Message');
    });

    it.each([
        { tab: 'Terraform', language: 'hcl', code: 'partition_key_paths   = ["/conversationId"]' },
        { tab: 'SDK (C#)', language: 'csharp', code: 'partitionKeyPath: "/conversationId"' },
    ])('switches the snippet and language to $tab and copies its contents', async ({ tab, language, code }) => {
        const user = userEvent.setup();
        const writeText = vi.spyOn(navigator.clipboard, 'writeText');
        renderResult();
        const initialHeight = screen.getByRole('textbox').parentElement?.style.height;

        const languageTab = screen.getByRole('tab', { name: tab });
        expect(languageTab).toHaveTextContent(tab);
        expect(languageTab).toHaveAccessibleName(tab);
        await user.click(languageTab);

        expect(editorProps()).toMatchObject({ language, value: expect.stringContaining(code) });
        expect(screen.getByRole('textbox').parentElement?.style.height).not.toBe(initialHeight);

        const copyButton = screen.getByRole('button', { name: 'Copy' });
        expect(copyButton).toHaveTextContent('Copy');
        expect(copyButton).toHaveAccessibleName('Copy');
        await user.click(copyButton);
        expect(writeText).toHaveBeenCalledWith(editorProps()?.value);
    });

    it('updates the snippet when switching containers', async () => {
        const user = userEvent.setup();
        renderResult();

        await user.click(screen.getByRole('tab', { name: 'Container: User' }));

        expect(editorProps()).toMatchObject({
            language: 'bicep',
            value: expect.stringContaining("name: 'User'"),
        });
        expect(editorProps()?.value).toContain("paths: [ '/userId' ]");
        expect(editorProps()?.value).not.toContain('Message');
    });
});
