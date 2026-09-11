/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { type EditorProps } from '@monaco-editor/react';
import { render, screen, waitFor, within } from '@testing-library/react';
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

    const appliedWeights = { read: 33.34, write: 33.33, storage: 33.33 };
    const scoredRecommendation: PartitionKeyRecommendation = {
        summary: 'Analysis complete',
        containers: [
            {
                entity: 'Message',
                partitionKey: '/conversationId',
                rationale: 'Best weighted score',
                candidates: [
                    {
                        partitionKey: '/conversationId',
                        score: 80.001,
                        verdict: 'recommended',
                        assessments: [],
                        priorityScores: { read: 90, write: 70, storage: 80 },
                    },
                    {
                        partitionKey: '/userId',
                        score: 66.665,
                        verdict: 'alternative',
                        assessments: [],
                        priorityScores: { read: 50, write: 100, storage: 50 },
                    },
                    {
                        partitionKey: '/status',
                        score: 20,
                        verdict: 'avoid',
                        assessments: [],
                        priorityScores: { read: 20, write: 20, storage: 20 },
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
                weights={appliedWeights}
                onRetryRecommendation={vi.fn()}
                {...props}
            />,
        );
    }

    describe('scoring priorities', () => {
        it('rounds display values upward without changing source scores or rankings', () => {
            const recommendation = structuredClone(scoredRecommendation);
            const candidates = recommendation.containers[0].candidates!;
            candidates[0].score = 92.41;
            candidates[1].score = 83;
            candidates[2].score = 0;
            renderScores({ recommendation, weights: { read: 17.99, write: 66.51, storage: 15.5 } });
            expect(screen.getAllByRole('button', { name: /^Score / }).map((button) => button.textContent)).toEqual([
                '93',
                '83',
                '0',
            ]);
            const priorities = screen.getByRole('group', { name: 'Applied scoring priorities' });
            expect(priorities).toHaveClass('fui-Card');
            const title = within(priorities).getByRole('heading', { name: 'Applied scoring priorities' });
            expect(title).toHaveClass('fui-Text');
            expect(within(priorities).getByText('Read / query alignment: 18%')).toHaveClass('fui-Badge');
            expect(within(priorities).getByText('Write distribution: 67%')).toHaveClass('fui-Badge');
            expect(within(priorities).getByText('Storage & growth: 16%')).toHaveClass('fui-Badge');
            expect(priorities).toHaveTextContent('Read / query alignment: 18%');
            expect(priorities).toHaveTextContent('Write distribution: 67%');
            expect(priorities).toHaveTextContent('Storage & growth: 16%');
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

        it('displays captured priorities read-only above recommendations without changing their order or verdicts', () => {
            renderScores();
            const priorities = screen.getByRole('group', { name: 'Applied scoring priorities' });
            expect(priorities).toHaveTextContent('Read / query alignment: 34%');
            expect(priorities).toHaveTextContent('Write distribution: 34%');
            expect(priorities).toHaveTextContent('Storage & growth: 34%');
            expect(screen.queryByRole('slider')).not.toBeInTheDocument();
            const scores = screen.getAllByRole('button', { name: /^Score / });
            expect(scores.map((score) => score.textContent)).toEqual(['81', '67', '20']);
            expect(priorities.compareDocumentPosition(scores[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
            for (const verdict of ['Recommended', 'Alternative', 'Avoid']) {
                expect(screen.getByText(verdict)).toBeVisible();
            }
        });

        it('shows the normalized formula on hover and closes it on Escape', async () => {
            const user = userEvent.setup();
            renderScores();
            const score = screen.getByRole('button', { name: /^Score 81 out of 100 for Message \/conversationId/ });
            expect(score).toHaveTextContent('81');
            expect(score).toHaveAccessibleName(
                'Score 81 out of 100 for Message /conversationId. Show weighted calculation.',
            );
            await user.hover(score);
            const formula = await screen.findByRole('group', { name: 'Weighted score calculation' });
            expect(formula).toHaveTextContent('Read alignment: 90 × 34% / 100% ≈ 31');
            expect(formula).toHaveTextContent('Write distribution: 70 × 34% / 100% ≈ 24');
            expect(formula).toHaveTextContent('Storage & growth: 80 × 34% / 100% ≈ 27');
            expect(formula).toHaveTextContent('Normalized total: (90 × 34 + 70 × 34 + 80 × 34) / 100 ≈ 81');
            expect(formula).toHaveTextContent('Final score: 81 / 100 (rounded up).');
            expect(formula).toHaveTextContent('score and ranking use the original values');
            expect(formula.textContent).not.toMatch(/\d[.,]\d/);
            await user.keyboard('{Escape}');
            await waitFor(() =>
                expect(screen.queryByRole('group', { name: 'Weighted score calculation' })).not.toBeInTheDocument(),
            );
        });

        it('retains all tied recommended verdicts supplied by application ranking', () => {
            const recommendation = structuredClone(scoredRecommendation);
            const candidates = recommendation.containers[0].candidates!;
            candidates[1] = {
                ...candidates[1],
                score: candidates[0].score,
                priorityScores: candidates[0].priorityScores,
                verdict: 'recommended',
            };
            renderScores({ recommendation });
            expect(screen.getAllByText('Recommended')).toHaveLength(2);
            expect(screen.queryByText('Alternative')).not.toBeInTheDocument();
            expect(screen.getByText('Avoid')).toBeVisible();
            expect(screen.getAllByRole('button', { name: /^Score 81 / })).toHaveLength(2);
        });

        it('pins a clicked formula after the pointer and focus leave, until clicked again', async () => {
            const user = userEvent.setup();
            renderScores();
            const score = screen.getByRole('button', { name: /^Score 81 / });
            await user.click(score);
            const formula = await screen.findByRole('group', { name: 'Weighted score calculation' });
            await user.unhover(score);
            await user.tab();
            expect(formula).toBeVisible();
            await user.click(score);
            await waitFor(() => expect(score).toHaveAttribute('aria-expanded', 'false'));
        });

        it('opens on keyboard focus and supports Enter, Space, and Escape for every score', async () => {
            const user = userEvent.setup();
            renderScores();
            const scores = screen.getAllByRole('button', { name: /^Score / });
            for (const score of scores) {
                await user.tab();
                expect(score).toHaveFocus();
                expect(score).toHaveAccessibleName(expect.stringContaining(score.textContent ?? ''));
                expect(await screen.findByRole('group', { name: 'Weighted score calculation' })).toBeVisible();
                await user.keyboard('{Enter}');
                expect(score).toHaveAttribute('aria-expanded', 'true');
                await user.keyboard(' ');
                await waitFor(() => expect(score).toHaveAttribute('aria-expanded', 'false'));
                await user.keyboard('{Enter}');
                expect(score).toHaveAttribute('aria-expanded', 'true');
                await user.keyboard('{Escape}');
                await waitFor(() => expect(score).toHaveAttribute('aria-expanded', 'false'));
            }
        });

        it('dismisses a hover preview when clicking outside instead of pinning it', async () => {
            const user = userEvent.setup();
            renderScores();
            const score = screen.getByRole('button', { name: /^Score 81 / });
            await user.hover(score);
            expect(await screen.findByRole('group', { name: 'Weighted score calculation' })).toBeVisible();
            await user.click(screen.getByRole('button', { name: 'Copy' }));
            await waitFor(() => expect(score).toHaveAttribute('aria-expanded', 'false'));
        });

        it('uses captured request weights for the read-only priorities and formula', async () => {
            const user = userEvent.setup();
            const recommendation = structuredClone(scoredRecommendation);
            recommendation.containers[0].candidates![0].score = 90;
            renderScores({ recommendation, weights: { read: 100, write: 0, storage: 0 } });
            expect(screen.getByText('Read / query alignment: 100%')).toBeVisible();
            await user.click(screen.getByRole('button', { name: /^Score 90 / }));
            const formula = await screen.findByRole('group', { name: 'Weighted score calculation' });
            expect(formula).toHaveTextContent('Read alignment: 90 × 100% / 100% ≈ 90');
            expect(formula).toHaveTextContent('Final score: 90 / 100 (rounded up).');
        });

        it.each(['weights', 'priorityScores'] as const)(
            'does not invent a calculation when legacy %s are absent',
            async (missing) => {
                const user = userEvent.setup();
                const legacy = structuredClone(scoredRecommendation);
                if (missing === 'priorityScores') {
                    delete legacy.containers[0].candidates?.[0].priorityScores;
                }
                renderScores({ recommendation: legacy, weights: missing === 'weights' ? undefined : appliedWeights });
                await user.click(screen.getByRole('button', { name: /^Score 81 / }));
                const formula = await screen.findByRole('group', { name: 'Weighted score calculation' });
                expect(
                    within(formula).getByText(
                        'Regenerate this recommendation to see its applied priorities and weighted score calculation.',
                    ),
                ).toBeVisible();
                expect(formula).not.toHaveTextContent('Normalized total:');
            },
        );
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
        expect(screen.queryByRole('button', { name: 'Create Container' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Deploy' })).not.toBeInTheDocument();
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
