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
        expect(MonacoEditor).not.toHaveBeenCalled();

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

    it('keeps deployment code and actions out of the recommendation step', () => {
        renderResult();
        expect(MonacoEditor).not.toHaveBeenCalled();
        expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
        for (const name of ['Bicep', 'Terraform', 'SDK (C#)']) {
            expect(screen.queryByRole('tab', { name })).not.toBeInTheDocument();
        }
        expect(screen.queryByRole('button', { name: 'Create Container' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Copy' })).not.toBeInTheDocument();
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

    it('switches container analysis without mounting a code editor', async () => {
        const user = userEvent.setup();
        renderResult();

        await user.click(screen.getByRole('tab', { name: 'Container: User' }));

        expect(screen.getByRole('tab', { name: 'Container: User' })).toHaveAttribute('aria-selected', 'true');
        expect(MonacoEditor).not.toHaveBeenCalled();
    });
});
