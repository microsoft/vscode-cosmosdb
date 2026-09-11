/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { type EditorProps } from '@monaco-editor/react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type PartitionKeyRecommendation } from '../../../api/types';
import { MonacoEditor } from '../../../MonacoEditor';
import { ResultPage, type ResultPageProps } from './ResultPage';

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

function renderResult(value = recommendation) {
    return render(
        <ResultPage recommendationStatus="received" recommendation={value} onRetryRecommendation={vi.fn()} />,
    );
}

function editorProps() {
    return vi.mocked(MonacoEditor).mock.calls.at(-1)?.[0];
}

describe('ResultPage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('shows relevant absolute rules as the final named section for each container', async () => {
        const user = userEvent.setup();
        const value = structuredClone(recommendation);
        value.containers[0].guardrails = [
            {
                rule: 'Logical-partition storage',
                detail: 'The supplied retention bound keeps each full conversation key below 20 GB.',
            },
        ];
        value.containers[1].guardrails = [
            {
                rule: 'Immutability',
                detail: 'userId is immutable; mutable email is not recommended.',
            },
        ];
        renderResult(value);
        const section = screen.getByRole('region', { name: 'Absolute rules (guardrails)' });
        expect(within(section).getByRole('heading', { name: 'Absolute rules (guardrails)', level: 2 })).toBeVisible();
        expect(within(section).getAllByRole('listitem')).toHaveLength(1);
        expect(within(section).getByText('Logical-partition storage')).toBeVisible();
        expect(within(section).getByText(value.containers[0].guardrails[0].detail)).toBeVisible();
        expect(section.parentElement?.lastElementChild).toBe(section);
        expect(section.previousElementSibling).toContainElement(
            screen.getByRole('textbox', { name: 'Container creation code sample' }),
        );

        await user.click(screen.getByRole('tab', { name: 'Container: User' }));
        const userSection = screen.getByRole('region', { name: 'Absolute rules (guardrails)' });
        expect(within(userSection).getByText(value.containers[1].guardrails[0].detail)).toBeVisible();
        expect(screen.queryByText('Logical-partition storage')).not.toBeInTheDocument();
        expect(userSection.parentElement?.lastElementChild).toBe(userSection);
    });

    it.each([{ guardrails: undefined }, { guardrails: [] }])(
        'omits the guardrails section when no relevant rules are supplied (%j)',
        ({ guardrails }) => {
            const value = structuredClone(recommendation);
            value.containers[0].guardrails = guardrails;
            renderResult(value);
            expect(screen.queryByRole('region', { name: 'Absolute rules (guardrails)' })).not.toBeInTheDocument();
        },
    );

    const scoredRecommendation: PartitionKeyRecommendation = {
        summary: 'Analysis complete',
        containers: [
            {
                entity: 'Message',
                partitionKey: '/conversationId',
                rationale: 'Best fit for this workload',
                candidates: [
                    {
                        partitionKey: '/conversationId',
                        score: 80.001,
                        verdict: 'recommended',
                        assessments: [],
                    },
                    {
                        partitionKey: '/userId',
                        score: 66.665,
                        verdict: 'alternative',
                        assessments: [],
                    },
                    {
                        partitionKey: '/status',
                        score: 20,
                        verdict: 'avoid',
                        assessments: [],
                    },
                ],
            },
        ],
    };

    function renderScores(props: Partial<ResultPageProps> = {}) {
        return render(
            <ResultPage
                recommendationStatus="received"
                recommendation={scoredRecommendation}
                onRetryRecommendation={vi.fn()}
                {...props}
            />,
        );
    }

    describe('candidate cards', () => {
        it('rounds display values upward without changing source scores or rankings', () => {
            const recommendation = structuredClone(scoredRecommendation);
            const candidates = recommendation.containers[0].candidates!;
            candidates[0].score = 92.41;
            candidates[1].score = 83;
            candidates[2].score = 0;
            renderScores({ recommendation });
            expect(screen.getAllByRole('img', { name: /^Score / }).map((ring) => ring.textContent)).toEqual([
                '93',
                '83',
                '0',
            ]);
            expect(candidates.map((candidate) => candidate.score)).toEqual([92.41, 83, 0]);
        });

        it('renders each assessment as a heading with a separate full-width description', () => {
            const recommendation = structuredClone(scoredRecommendation);
            recommendation.containers[0].candidates![0].assessments = [
                { label: 'Query alignment', status: 'pass', detail: 'Queries can target one logical partition.' },
                { label: 'Write distribution', status: 'warn', detail: 'Some sessions may receive more writes.' },
            ];
            renderScores({ recommendation });
            const section = screen.getByRole('region', { name: 'Pass Query alignment' });
            const heading = within(section).getByRole('heading', { name: 'Pass Query alignment' });
            const description = within(section).getByText('Queries can target one logical partition.');
            expect(heading.tagName).toBe('H3');
            expect(description.tagName).toBe('P');
            expect(heading.parentElement).toBe(description.parentElement);
            expect(heading.nextElementSibling).toBe(description);
            expect(within(section).getByRole('img', { name: 'Pass' })).toBeVisible();
        });

        it('displays recommendations without priorities and preserves their order and verdicts', () => {
            renderScores();
            expect(screen.queryByText(/priorities/i)).not.toBeInTheDocument();
            expect(screen.queryByRole('slider')).not.toBeInTheDocument();
            const scores = screen.getAllByRole('img', { name: /^Score / });
            expect(scores.map((score) => score.textContent)).toEqual(['81', '67', '20']);
            for (const verdict of ['Recommended', 'Alternative', 'Avoid']) {
                expect(screen.getByText(verdict)).toBeVisible();
            }
        });

        it('renders accessible, non-interactive score rings without hover bubbles', async () => {
            const user = userEvent.setup();
            renderScores();
            const score = screen.getByRole('img', { name: 'Score 81 out of 100 for Message /conversationId' });
            expect(score).toHaveTextContent('81');
            expect(score).toHaveAccessibleName('Score 81 out of 100 for Message /conversationId');
            expect(score).not.toHaveAttribute('tabindex');
            expect(score).not.toHaveAttribute('aria-expanded');
            expect(score).not.toHaveAttribute('aria-describedby');
            expect(screen.queryByRole('button', { name: /^Score / })).not.toBeInTheDocument();
            await user.hover(score);
            await user.click(score);
            expect(screen.queryByRole('group', { name: 'Weighted score calculation' })).not.toBeInTheDocument();
            expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
            await user.tab();
            for (const ring of screen.getAllByRole('img', { name: /^Score / })) {
                expect(ring).not.toHaveFocus();
                expect(ring.tabIndex).toBe(-1);
            }
        });

        it('retains all tied recommended verdicts supplied by the model', () => {
            const recommendation = structuredClone(scoredRecommendation);
            const candidates = recommendation.containers[0].candidates!;
            candidates[1] = {
                ...candidates[1],
                score: candidates[0].score,
                verdict: 'recommended',
            };
            renderScores({ recommendation });
            expect(screen.getAllByText('Recommended')).toHaveLength(2);
            expect(screen.queryByText('Alternative')).not.toBeInTheDocument();
            expect(screen.getByText('Avoid')).toBeVisible();
            expect(screen.getAllByRole('img', { name: /^Score 81 / })).toHaveLength(2);
        });
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
                stickyScroll: { enabled: false },
                padding: { top: 0, bottom: 0 },
                scrollBeyondLastLine: false,
                wordWrap: 'off',
            },
        });

        expect(screen.queryByRole('button', { name: 'Create Container' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Deploy' })).not.toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'Container: Message' })).toHaveTextContent('Container: Message');
    });

    it('keeps the document ID strategy badge', () => {
        const value = structuredClone(scoredRecommendation);
        value.containers[0].documentIdStrategy = {
            tag: 'Message ID',
            recommendation: 'Use a unique message ID.',
        };
        renderResult(value);
        expect(screen.getByText('Message ID')).toHaveClass('fui-Badge');
        expect(screen.getByText('Use a unique message ID.')).toBeVisible();
    });

    it.each(['Bicep', 'Terraform', 'SDK (C#)'])(
        'keeps a persistent inset and accounts for frame spacing in the %s preview height',
        async (tab) => {
            renderResult();
            await userEvent.click(screen.getByRole('tab', { name: tab }));
            const frame = screen.getByRole('textbox', { name: 'Container creation code sample' }).parentElement!;
            const style = getComputedStyle(frame);
            expect(style.boxSizing).toBe('border-box');
            for (const padding of [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft]) {
                expect(padding).toBe('12px');
            }
            const lines = editorProps()!.value!.split('\n').length;
            expect(frame.style.height).toBe(`${Math.min(400, lines * 20 + 2 * (12 + 1) + 12)}px`);
            expect(editorProps()?.options).toMatchObject({
                padding: { top: 0, bottom: 0 },
                stickyScroll: { enabled: false },
                wordWrap: 'off',
            });
        },
    );

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
        expect(editorProps()?.value).toContain("paths: ['/userId']");
        expect(editorProps()?.value).not.toContain('Message');
    });

    it('renders real Bicep resources referencing an existing account and database with hierarchical keys', () => {
        renderResult({
            summary: '',
            containers: [{ entity: 'Orders', partitionKey: '/tenantId, /address/zip', rationale: '' }],
        });
        expect(editorProps()?.value).toContain(
            "resource account 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' existing",
        );
        expect(editorProps()?.value).toContain(
            "resource sqlDatabase 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-05-15' existing",
        );
        expect(editorProps()?.value).toContain("paths: ['/tenantId', '/address/zip']");
        expect(editorProps()?.value).toContain("kind: 'MultiHash'");
        expect(editorProps()?.value).toContain('version: 2');
        expect(editorProps()?.value).not.toContain('sqlRoleAssignments');
    });

    it.each([
        { tab: 'Terraform', code: 'partition_key_paths   = ["/tenantId", "/address/zip"]' },
        { tab: 'SDK (C#)', code: 'partitionKeyPaths: new[] { "/tenantId", "/address/zip" }' },
    ])('keeps the $tab snippet aligned with deployed hierarchical keys', async ({ tab, code }) => {
        renderResult({
            summary: '',
            containers: [{ entity: 'Orders', partitionKey: '/tenantId, /address/zip', rationale: '' }],
        });
        await userEvent.click(screen.getByRole('tab', { name: tab }));
        expect(editorProps()?.value).toContain(code);
    });

    it('escapes names as literal strings in each infrastructure snippet', async () => {
        renderResult({
            summary: '',
            containers: [{ entity: "o'brien${literal}", partitionKey: '/id', rationale: '' }],
        });
        expect(editorProps()?.value).toContain("name: 'o\\'brien\\${literal}'");
        await userEvent.click(screen.getByRole('tab', { name: 'Terraform' }));
        expect(editorProps()?.value).toContain('name                  = "o\'brien$${literal}"');
        await userEvent.click(screen.getByRole('tab', { name: 'SDK (C#)' }));
        expect(editorProps()?.value).toContain('id: "o\'brien${literal}"');
    });
});
