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
        it.each(['recommended', 'alternative'] as const)(
            'orders %s reasons by status, preserving order within each category',
            (verdict) => {
                const recommendation = structuredClone(scoredRecommendation);
                const candidate = recommendation.containers[0].candidates![0];
                candidate.verdict = verdict;
                candidate.assessments = [
                    { label: 'Violation', status: 'fail', detail: 'Known violation.' },
                    { label: 'Legacy warning', status: 'info', detail: 'Unverified limit.' },
                    { label: 'First strength', status: 'pass', detail: 'Supported strength.' },
                    { label: 'Warning', status: 'warn', detail: 'Trade-off.' },
                    { label: 'Second strength', status: 'pass', detail: 'Another strength.' },
                ];
                const original = structuredClone(candidate.assessments);
                renderScores({ recommendation });
                expect(screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual([
                    '✓First strength',
                    '✓Second strength',
                    '!Legacy warning',
                    '!Warning',
                    '✗Violation',
                ]);
                expect(candidate.assessments).toEqual(original);
            },
        );

        it('uses only check, exclamation, and cross categories, including for legacy information', () => {
            const recommendation = structuredClone(scoredRecommendation);
            recommendation.containers[0].candidates![1].assessments = [
                { label: 'Query alignment', status: 'pass', detail: 'Reads target one partition.' },
                { label: 'Write distribution', status: 'warn', detail: 'Some keys receive more writes.' },
                { label: 'Cardinality', status: 'fail', detail: 'Too few distinct values.' },
                { label: 'Capacity', status: 'info', detail: 'Per-key retention needs verification.' },
            ];
            renderScores({ recommendation });
            expect(screen.getByRole('img', { name: 'Pass' })).toHaveTextContent('✓');
            expect(screen.getByRole('img', { name: 'Fail' })).toHaveTextContent('✗');
            const warnings = screen.getAllByRole('img', { name: 'Warning' });
            expect(warnings).toHaveLength(2);
            for (const warning of warnings) {
                expect(warning).toHaveTextContent('!');
                expect(warning).toHaveAccessibleName('Warning');
            }
            expect(warnings[0].className).toBe(warnings[1].className);
            expect(screen.queryByRole('img', { name: 'Information' })).not.toBeInTheDocument();
        });

        it.each([4, 5, 6])('shows up to five supplied reasons for a recommendation with %i reasons', (count) => {
            const recommendation = structuredClone(scoredRecommendation);
            recommendation.containers[0].candidates![0].assessments = Array.from({ length: count }, (_, index) => ({
                label: `Rule ${index}`,
                status: 'pass',
                detail: `Evidence ${index}`,
            }));
            renderScores({ recommendation });
            expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(Math.min(count, 5));
            expect(screen.getByText(`Evidence ${Math.min(count, 5) - 1}`)).toBeVisible();
            expect(screen.queryByText('Evidence 5')).not.toBeInTheDocument();
        });

        it.each([
            { count: 1, details: ['Too few distinct values.'] },
            { count: 2, details: ['Verify retention.', 'Too few distinct values.'] },
            { count: 4, details: ['Too few distinct values.', 'Writes concentrate on one key.'] },
        ])('shows at most two decisive reasons for Avoid with $count supplied reasons', ({ count, details }) => {
            const recommendation = structuredClone(scoredRecommendation);
            const candidate = recommendation.containers[0].candidates![2];
            candidate.assessments = [
                { label: 'Cardinality', status: 'fail', detail: 'Too few distinct values.' },
                { label: 'Capacity', status: 'warn', detail: 'Verify retention.' },
                { label: 'Query alignment', status: 'pass', detail: 'Some reads are targeted.' },
                { label: 'Write distribution', status: 'fail', detail: 'Writes concentrate on one key.' },
            ];
            candidate.assessments = candidate.assessments.slice(0, count);
            const original = structuredClone(candidate.assessments);
            renderScores({ recommendation });
            expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(Math.min(count, 2));
            expect(screen.getByText('Too few distinct values.')).toBeVisible();
            expect(
                screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.nextElementSibling?.textContent),
            ).toEqual(details);
            expect(candidate.assessments).toEqual(original);
        });

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

    describe('recommendation feedback', () => {
        const upLabel = 'Helpful recommendation';
        const downLabel = 'Unhelpful recommendation';
        const groupLabel = 'Recommendation feedback';

        function feedbackProps(overrides: Partial<ResultPageProps> = {}): ResultPageProps {
            return {
                recommendationStatus: 'received',
                recommendation,
                onRetryRecommendation: vi.fn(),
                onFeedback: vi.fn(),
                ...overrides,
            };
        }

        it('shows only two named icon buttons and allows feedback without a callback', async () => {
            const user = userEvent.setup();
            render(<ResultPage {...feedbackProps({ onFeedback: undefined })} />);
            const group = screen.getByRole('group', { name: groupLabel });
            expect(within(group).getAllByRole('button')).toHaveLength(2);
            for (const label of [upLabel, downLabel]) {
                const button = within(group).getByRole('button', { name: label });
                expect(button).toHaveAccessibleName(label);
                expect(button).toHaveAttribute('aria-pressed', 'false');
                expect(button).toHaveTextContent('');
                expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
            }
            await user.click(within(group).getByRole('button', { name: upLabel }));
            expect(within(group).getByRole('button', { name: upLabel })).toHaveAttribute('aria-pressed', 'true');
        });

        it('reports each changed vote, suppresses duplicates, and allows switching back', async () => {
            const user = userEvent.setup();
            const props = feedbackProps();
            render(<ResultPage {...props} />);
            const up = screen.getByRole('button', { name: upLabel });
            const down = screen.getByRole('button', { name: downLabel });

            await user.click(up);
            await user.click(up);
            expect(props.onFeedback).toHaveBeenCalledTimes(1);
            expect(props.onFeedback).toHaveBeenLastCalledWith('up');
            expect(up).toHaveAttribute('aria-pressed', 'true');
            expect(down).toHaveAttribute('aria-pressed', 'false');

            await user.click(down);
            await user.click(down);
            expect(props.onFeedback).toHaveBeenCalledTimes(2);
            expect(props.onFeedback).toHaveBeenLastCalledWith('down');
            expect(up).toHaveAttribute('aria-pressed', 'false');
            expect(down).toHaveAttribute('aria-pressed', 'true');

            await user.click(up);
            expect(props.onFeedback).toHaveBeenCalledTimes(3);
            expect(props.onFeedback).toHaveBeenLastCalledWith('up');
        });

        it('retains the vote across container tabs and rerenders but resets for another recommendation', async () => {
            const user = userEvent.setup();
            const props = feedbackProps();
            const { rerender } = render(<ResultPage {...props} />);
            await user.click(screen.getByRole('button', { name: upLabel }));
            await user.click(screen.getByRole('tab', { name: 'Container: User' }));
            rerender(<ResultPage {...props} />);
            expect(screen.getByRole('button', { name: upLabel })).toHaveAttribute('aria-pressed', 'true');
            expect(props.onFeedback).toHaveBeenCalledTimes(1);

            const nextRecommendation = { ...recommendation, summary: 'New recommendation' };
            rerender(<ResultPage {...props} recommendation={nextRecommendation} />);
            for (const label of [upLabel, downLabel]) {
                expect(screen.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'false');
            }
            expect(props.onFeedback).toHaveBeenCalledTimes(1);
            await user.click(screen.getByRole('button', { name: upLabel }));
            expect(props.onFeedback).toHaveBeenCalledTimes(2);
            expect(props.onFeedback).toHaveBeenLastCalledWith('up');

            rerender(<ResultPage {...props} />);
            expect(screen.getByRole('button', { name: upLabel })).toHaveAttribute('aria-pressed', 'false');
        });

        it('supports Tab navigation, Enter and Space activation, and keyboard tooltips', async () => {
            // Fluent hides tooltips whose anchor is outside the viewport; jsdom has no layout.
            const width = vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(1024);
            const height = vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(768);
            const bounds = vi
                .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
                .mockImplementation(function (this: HTMLElement) {
                    return this === document.documentElement || this === document.body
                        ? new DOMRect(0, 0, 1024, 768)
                        : new DOMRect(100, 100, 120, 32);
                });
            try {
                const user = userEvent.setup();
                const props = feedbackProps({
                    recommendation: { summary: '', containers: [recommendation.containers[0]] },
                });
                render(<ResultPage {...props} />);
                const up = screen.getByRole('button', { name: upLabel });
                const down = screen.getByRole('button', { name: downLabel });

                await user.tab();
                expect(up).toHaveFocus();
                expect(await screen.findByRole('tooltip', { name: upLabel })).toHaveTextContent(upLabel);
                expect(up).toHaveAccessibleName(upLabel);
                expect(up).not.toHaveAttribute('aria-describedby');
                await user.keyboard('{Enter}{Enter}');
                expect(props.onFeedback).toHaveBeenCalledTimes(1);
                expect(props.onFeedback).toHaveBeenLastCalledWith('up');

                await user.tab();
                expect(down).toHaveFocus();
                expect(await screen.findByRole('tooltip', { name: downLabel })).toHaveTextContent(downLabel);
                await user.keyboard(' ');
                expect(props.onFeedback).toHaveBeenCalledTimes(2);
                expect(props.onFeedback).toHaveBeenLastCalledWith('down');
                expect(down).toHaveAttribute('aria-pressed', 'true');
            } finally {
                bounds.mockRestore();
                height.mockRestore();
                width.mockRestore();
            }
        });

        it('restores parent-owned feedback after remount and accepts controlled updates and resets', async () => {
            const user = userEvent.setup();
            const props = feedbackProps({ feedback: 'up' });
            const firstMount = render(<ResultPage {...props} />);
            expect(screen.getByRole('button', { name: upLabel })).toHaveAttribute('aria-pressed', 'true');
            firstMount.unmount();

            const { rerender } = render(<ResultPage {...props} />);
            const up = screen.getByRole('button', { name: upLabel });
            const down = screen.getByRole('button', { name: downLabel });
            expect(up).toHaveAttribute('aria-pressed', 'true');
            await user.click(up);
            expect(props.onFeedback).not.toHaveBeenCalled();

            await user.click(down);
            expect(props.onFeedback).toHaveBeenCalledExactlyOnceWith('down');
            rerender(<ResultPage {...props} feedback="down" />);
            expect(up).toHaveAttribute('aria-pressed', 'false');
            expect(down).toHaveAttribute('aria-pressed', 'true');
            await user.click(down);
            expect(props.onFeedback).toHaveBeenCalledTimes(1);

            rerender(<ResultPage {...props} feedback={undefined} />);
            expect(up).toHaveAttribute('aria-pressed', 'false');
            expect(down).toHaveAttribute('aria-pressed', 'false');
            expect(props.onFeedback).toHaveBeenCalledTimes(1);
        });

        it.each<Partial<ResultPageProps>>([
            { recommendationStatus: 'idle' },
            { recommendationStatus: 'waiting' },
            { recommendationStatus: 'error', recommendationError: 'Try again' },
            { recommendation: undefined },
            { recommendation: { summary: '', containers: [] } },
        ])('hides feedback for an unsuccessful or empty result (%j)', (overrides) => {
            const props = feedbackProps(overrides);
            render(<ResultPage {...props} />);
            expect(screen.queryByRole('group', { name: groupLabel })).not.toBeInTheDocument();
            expect(screen.queryByRole('button', { name: upLabel })).not.toBeInTheDocument();
            expect(screen.queryByRole('button', { name: downLabel })).not.toBeInTheDocument();
            expect(props.onFeedback).not.toHaveBeenCalled();
        });
    });
});
