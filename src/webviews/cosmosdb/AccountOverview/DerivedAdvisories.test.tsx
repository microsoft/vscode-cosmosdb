/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import {
    accordionClassNames,
    accordionHeaderClassNames,
    accordionPanelClassNames,
    badgeClassNames,
    cardClassNames,
    FluentProvider,
    messageBarClassNames,
    webLightTheme,
} from '@fluentui/react-components';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type DerivedAdvisoriesResult } from '../../api/types';
import { DashboardActionsProvider } from './DashboardChrome';
import { DerivedAdvisories } from './DerivedAdvisories';

afterEach(cleanup);

function showCoverage(source: DerivedAdvisoriesResult['logSource'], overrides: Partial<DerivedAdvisoriesResult> = {}) {
    const openUrl = vi.fn();
    const showOutput = vi.fn();
    const onDismiss = vi.fn();
    render(
        <FluentProvider theme={webLightTheme}>
            <DashboardActionsProvider value={{ openUrl, showOutput, reportEvent: vi.fn() }}>
                <DerivedAdvisories
                    result={{ available: true, generatedAt: 0, advisories: [], logSource: source, ...overrides }}
                    loading={false}
                    dismissedIds={new Set()}
                    onDismiss={onDismiss}
                />
            </DashboardActionsProvider>
        </FluentProvider>,
    );
    return { openUrl, showOutput, onDismiss };
}

describe('log coverage guidance', () => {
    it('names the failed check and explains resource/workspace access instead of assuming one missing role', () => {
        const { openUrl } = showCoverage({
            available: false,
            reason: 'rbac',
            failures: [{ operation: 'probeDataPlane', kind: 'accessDenied', reason: 'rbac' }],
        });

        const notice = screen.getByRole('group', { name: 'Partial coverage' });
        expect(notice).toHaveClass(messageBarClassNames.root);
        expect(notice).not.toHaveAttribute('tabindex');
        expect(notice.querySelector(`.${messageBarClassNames.icon}`)).toHaveAttribute('aria-hidden', 'true');
        expect(screen.getByText('DataPlaneRequests availability: Access denied')).toBeDefined();
        expect(
            screen.getByText(
                'Some log-based checks were denied access. ' +
                    'Check the signed-in identity, resource log permissions, and the workspace access-control mode and table permissions. ' +
                    'Enabling diagnostic settings does not grant query access.',
            ),
        ).toBeInTheDocument();
        expect(screen.queryByText(/missing Log Analytics Reader/)).toBeNull();
        const guidance = screen.getByRole('button', { name: 'Learn about Log Analytics access' });
        expect(guidance.textContent).toBe('Learn about Log Analytics access');
        fireEvent.click(guidance);
        expect(openUrl).toHaveBeenCalledWith('https://learn.microsoft.com/azure/azure-monitor/logs/manage-access');
    });

    it('explains required categories and legacy mode without claiming logging is disabled', () => {
        showCoverage({
            available: false,
            reason: 'logAnalyticsDisabled',
            failures: [{ operation: 'probeQueryRuntime', kind: 'missingTable', reason: 'logAnalyticsDisabled' }],
        });
        expect(
            screen.getByText(
                'Some required CDB log tables could not be queried. ' +
                    'Check that DataPlaneRequests and QueryRuntimeStatistics are exported to Log Analytics ' +
                    'in resource-specific mode, not only AzureDiagnostics. ' +
                    'Missing tables can also reflect access restrictions or delayed ingestion.',
            ),
        ).toBeInTheDocument();
        expect(screen.getByText('QueryRuntimeStatistics availability: Required table unavailable')).toBeDefined();
        expect(screen.queryByText(/diagnostic settings aren't exporting/)).toBeNull();
    });

    it('distinguishes query errors from an empty time window and points to Output', () => {
        showCoverage({
            available: false,
            reason: 'noData',
            failures: [{ operation: 'crossPartition', kind: 'queryError', reason: 'noData' }],
        });
        expect(screen.getByText('Query fan-out: Query error')).toBeDefined();
        expect(
            screen.getByText(
                'Some log-based queries failed or returned incomplete results. ' +
                    'Available checks still contribute recommendations; this does not mean Log Analytics is disabled.',
            ),
        ).toBeInTheDocument();
        expect(screen.getByText(/extension Output channel/)).toBeDefined();
        expect(screen.queryByText(/no log telemetry in the window/)).toBeNull();
    });

    it('does not warn for successful empty queries', () => {
        showCoverage({ available: true });
        expect(screen.queryByText('Partial coverage')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Show Output' })).not.toBeInTheDocument();
    });

    it.each(['rbac', 'logAnalyticsDisabled', 'noData'] as const)(
        'opens Output from the %s coverage notice',
        async (reason) => {
            const user = userEvent.setup();
            const { showOutput, openUrl } = showCoverage({ available: false, reason });
            const button = screen.getByRole('button', { name: 'Show Output' });
            expect(button).toHaveTextContent('Show Output');
            expect(button).toHaveAccessibleName('Show Output');
            await user.click(button);
            expect(showOutput).toHaveBeenCalledTimes(1);
            expect(openUrl).not.toHaveBeenCalled();
        },
    );

    it('opens Output using the keyboard', async () => {
        const user = userEvent.setup();
        const { showOutput } = showCoverage({ available: false, reason: 'rbac' });
        const button = screen.getByRole('button', { name: 'Show Output' });
        await user.tab();
        const coverage = screen.getByLabelText('Partial coverage', { selector: '[tabindex="0"]' });
        expect(coverage).toHaveFocus();
        expect(coverage).toHaveTextContent('Partial coverage');
        expect(coverage).toHaveAccessibleName('Partial coverage');
        expect(coverage).toHaveAccessibleDescription('Some analyzers could not run, so coverage is partial.');
        await user.tab();
        expect(button).toHaveFocus();
        await user.keyboard('{Enter}');
        expect(showOutput).toHaveBeenCalledTimes(1);
    });
});

describe('metric coverage and actionable findings', () => {
    it('announces incomplete metric checks without claiming a clean result or blaming Log Analytics', () => {
        showCoverage(
            { available: true },
            {
                metricSource: {
                    available: false,
                    failures: [
                        { rule: 'IdleContainer', scope: 'db/a', reason: 'rbac' },
                        { rule: 'IdleContainer', scope: 'db/b', reason: 'rbac' },
                    ],
                },
            },
        );
        const notice = screen.getByRole('group', { name: 'Incomplete workload analysis' });
        expect(notice).toHaveClass(messageBarClassNames.root);
        expect(notice).not.toHaveAttribute('tabindex');
        expect(notice.querySelector(`.${messageBarClassNames.icon}`)).toHaveAttribute('aria-hidden', 'true');
        expect(within(notice).getByText('Incomplete workload analysis')).toBeInTheDocument();
        expect(
            screen.getByText(
                'Some workload checks could not run. Missing or failed metric queries are not treated as zero usage. ' +
                    'Configuration checks and successful analyses still contribute recommendations.',
            ),
        ).toBeInTheDocument();
        expect(screen.getAllByText(/Idle containers: Access denied/)).toHaveLength(1);
        expect(screen.getByText('No advisories from the checks that completed.')).toBeInTheDocument();
        expect(screen.queryByText('No advisories from your telemetry right now.')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Learn/ })).not.toBeInTheDocument();
        expect(screen.getByLabelText('Partial coverage', { selector: '[tabindex="0"]' })).toHaveAccessibleName(
            'Partial coverage',
        );
    });

    describe('advisory resource details', () => {
        const common = {
            rule: 'IdleContainer',
            severity: 'Low',
            title: 'Idle container',
            rationale: 'Almost no traffic was observed.',
            suggestedAction: 'Remove unused provisioned capacity.',
            thresholdReference: 'Peak consumption at most 50 RU.',
        } as const;

        function showDismissibleGroup() {
            function Harness() {
                const [dismissedIds, setDismissedIds] = useState<ReadonlySet<string>>(new Set());
                return (
                    <DerivedAdvisories
                        result={{
                            available: true,
                            generatedAt: 0,
                            advisories: ['a', 'b', 'c'].map((key) => ({
                                ...common,
                                id: `idle-${key}`,
                                scope: `db/${key}`,
                            })),
                        }}
                        loading={false}
                        dismissedIds={dismissedIds}
                        onDismiss={(id) => setDismissedIds((previous) => new Set([...previous, id]))}
                    />
                );
            }
            render(
                <FluentProvider theme={webLightTheme}>
                    <DashboardActionsProvider value={{ openUrl: vi.fn(), showOutput: vi.fn(), reportEvent: vi.fn() }}>
                        <Harness />
                    </DashboardActionsProvider>
                </FluentProvider>,
            );
        }

        it.each([
            ['a', 'b', '{Enter}'],
            ['b', 'c', ' '],
            ['c', 'b', '{Enter}'],
        ])('keeps focus inside the dialog after dismissing db/%s', async (removed, next, key) => {
            const user = userEvent.setup();
            showDismissibleGroup();
            const trigger = screen.getByRole('button', { name: /^Idle containers/ });
            await user.click(trigger);
            screen.getByRole('button', { name: `Dismiss advisory for db/${removed}` }).focus();
            await user.keyboard(key);
            const dialog = screen.getByRole('dialog');
            expect(within(dialog).queryByRole('button', { name: `Dismiss advisory for db/${removed}` })).toBeNull();
            expect(within(dialog).getByRole('button', { name: `Dismiss advisory for db/${next}` })).toHaveFocus();
            expect(within(dialog).getAllByRole('listitem')).toHaveLength(2);
            await user.keyboard('{Escape}');
            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
            expect(trigger).toHaveFocus();
        });

        it('closes the emptied group and focuses the surviving section after the last dismissal', async () => {
            const user = userEvent.setup();
            showDismissibleGroup();
            await user.click(screen.getByRole('button', { name: /^Idle containers/ }));
            screen.getByRole('button', { name: 'Dismiss advisory for db/a' }).focus();
            for (const key of ['a', 'b', 'c']) {
                expect(screen.getByRole('button', { name: `Dismiss advisory for db/${key}` })).toHaveFocus();
                await user.keyboard('{Enter}');
            }
            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
            expect(screen.queryByRole('button', { name: /^Idle containers/ })).not.toBeInTheDocument();
            expect(screen.getByLabelText('Recommendations')).toHaveFocus();
            expect(screen.getByText('No advisories from your telemetry right now.')).toBeVisible();
        });

        it('does not move focus when a dismissal removes an unfocused button', async () => {
            const user = userEvent.setup();
            showDismissibleGroup();
            await user.click(screen.getByRole('button', { name: /^Idle containers/ }));
            const close = screen.getByRole('button', { name: 'Close' });
            close.focus();
            fireEvent.click(screen.getByRole('button', { name: 'Dismiss advisory for db/a' }));
            expect(close).toHaveFocus();
            expect(screen.getAllByRole('listitem')).toHaveLength(2);
        });

        it('shows identical guidance once above a plain resource list and keeps individual dismissal', async () => {
            const user = userEvent.setup();
            const { onDismiss } = showCoverage(undefined, {
                advisories: [
                    { ...common, id: 'idle-a', scope: 'db/a' },
                    { ...common, id: 'idle-b', scope: 'db/b' },
                ],
            });
            await user.click(screen.getByRole('button', { name: /^Idle containers/ }));
            const dialog = within(screen.getByRole('dialog'));
            const list = dialog.getByRole('list', { name: 'Idle containers' });
            const items = within(list).getAllByRole('listitem');
            expect(items).toHaveLength(2);
            expect(items[0]).toHaveTextContent(/^db\/a$/);
            expect(items[1]).toHaveTextContent(/^db\/b$/);
            for (const text of [common.rationale, common.suggestedAction, common.thresholdReference]) {
                expect(dialog.getAllByText(text)).toHaveLength(1);
                expect(within(list).queryByText(text)).not.toBeInTheDocument();
            }
            expect(list.querySelector(`.${accordionClassNames.root}`)).toBeNull();
            const dismiss = dialog.getByRole('button', { name: 'Dismiss advisory for db/b' });
            expect(dismiss).toHaveAccessibleName('Dismiss advisory for db/b');
            await user.click(dismiss);
            expect(onDismiss).toHaveBeenCalledExactlyOnceWith('idle-b');
        });

        it.each([
            ['Enter', 'Escape'],
            ['Enter', 'Close button'],
            ['Space', 'Escape'],
            ['Space', 'Close button'],
        ] as const)(
            'opens a Fluent card with %s, keeps resource evidence, and restores focus after %s',
            async (openWith, closeWith) => {
                const user = userEvent.setup();
                showCoverage(undefined, {
                    advisories: [
                        { ...common, id: 'idle-a', scope: 'db/a', rationale: 'Peak: 10 RU.' },
                        { ...common, id: 'idle-b', scope: 'db/b', rationale: 'Peak: 20 RU.' },
                    ],
                });
                const trigger = screen.getByRole('button', { name: /^Idle containers/ });
                expect(trigger).toHaveClass(cardClassNames.root);
                const badge = within(trigger).getByText('Low');
                expect(badge).toHaveClass(badgeClassNames.root);
                expect(badge).not.toHaveAttribute('tabindex');
                expect(badge).not.toHaveAttribute('aria-hidden');
                expect(trigger).toHaveTextContent('Idle containers');
                expect(trigger).toHaveAccessibleName(/^Idle containers/);
                const descriptions = trigger
                    .getAttribute('aria-describedby')
                    ?.split(' ')
                    .map((id) => document.getElementById(id));
                expect(descriptions).toHaveLength(2);
                expect(descriptions?.[0]).toBe(badge);
                expect(descriptions?.[1]).toBeVisible();
                expect(trigger).toHaveAccessibleDescription(`Low ${descriptions?.[1]?.textContent}`);
                expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
                expect(within(trigger).queryByRole('button')).not.toBeInTheDocument();
                await user.tab();
                expect(trigger).toHaveFocus();
                await user.keyboard(`[${openWith}>]`);
                expect(screen.queryAllByRole('dialog')).toHaveLength(openWith === 'Enter' ? 1 : 0);
                await user.keyboard(`[/${openWith}]`);
                const dialog = within(screen.getByRole('dialog'));
                const list = dialog.getByRole('list', { name: 'Idle containers' });
                const summary = within(list).getByRole('button', { name: 'db/a' });
                expect(summary).toHaveClass(accordionHeaderClassNames.button);
                expect(summary).toHaveTextContent('db/a');
                expect(summary).toHaveAccessibleName('db/a');
                expect(summary).toHaveAttribute('aria-expanded', 'false');
                expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
                expect(dialog.getByText('Peak: 10 RU.').closest('[inert]')).not.toBeNull();
                expect(dialog.getByText('Peak: 20 RU.').closest('[inert]')).not.toBeNull();
                summary.focus();
                await user.keyboard('{Enter}');
                const evidence = dialog.getByRole('region', { name: 'db/a' });
                expect(evidence).toHaveClass(accordionPanelClassNames.root);
                expect(evidence).toHaveAttribute('id', summary.getAttribute('aria-controls'));
                expect(evidence).toHaveAttribute('aria-labelledby', summary.id);
                expect(summary).toHaveAttribute('aria-expanded', 'true');
                expect(summary).toHaveFocus();
                expect(dialog.getByText('Peak: 10 RU.')).toBeVisible();
                expect(dialog.getByText('Peak: 20 RU.').closest('[inert]')).not.toBeNull();
                expect(dialog.getAllByText(common.suggestedAction)).toHaveLength(1);
                expect(within(list).queryByText(common.suggestedAction)).not.toBeInTheDocument();
                expect(dialog.getAllByText(common.thresholdReference)).toHaveLength(1);
                await user.keyboard(' ');
                expect(summary).toHaveAttribute('aria-expanded', 'false');
                await waitFor(() => expect(evidence).toHaveAttribute('inert'));
                expect(summary).toHaveFocus();
                const close = dialog.getByRole('button', { name: 'Close' });
                expect(close).toHaveTextContent('Close');
                expect(close).toHaveAccessibleName('Close');
                if (closeWith === 'Escape') {
                    await user.keyboard('{Escape}');
                } else {
                    await user.click(close);
                }
                expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
                expect(trigger).toHaveFocus();
            },
        );

        it('keeps the full evidence and recommendation visible for a single account-wide finding', async () => {
            const user = userEvent.setup();
            showCoverage(undefined, {
                advisories: [{ ...common, id: 'account', rule: 'ServerlessCandidate' }],
            });
            await user.click(screen.getByRole('button', { name: /^Serverless candidates/ }));
            const dialog = within(screen.getByRole('dialog'));
            for (const text of [common.rationale, common.suggestedAction, common.thresholdReference]) {
                expect(dialog.getByText(text)).toBeVisible();
            }
            const list = dialog.getByRole('list', { name: 'Serverless candidates' });
            expect(within(list).getByRole('listitem')).toHaveTextContent(/^Account-wide$/);
            expect(list.querySelector(`.${accordionClassNames.root}`)).toBeNull();
        });

        it('renders marked values in shared guidance and resource-specific evidence without changing focus', async () => {
            const user = userEvent.setup();
            showCoverage(undefined, {
                advisories: [
                    {
                        ...common,
                        id: 'idle-a',
                        scope: 'db/a',
                        rationale: 'Peak: `10 RU`.',
                        suggestedAction: 'Recover `400 RU/s`.',
                        thresholdReference: 'Threshold: `50 RU`.',
                    },
                    {
                        ...common,
                        id: 'idle-b',
                        scope: 'db/b',
                        rationale: 'Peak: `20 RU`.',
                        suggestedAction: 'Recover `400 RU/s`.',
                        thresholdReference: 'Threshold: `50 RU`.',
                    },
                ],
            });
            await user.click(screen.getByRole('button', { name: /^Idle containers/ }));
            const dialog = within(screen.getByRole('dialog'));
            expect(dialog.getByText('400 RU/s').tagName).toBe('SPAN');
            expect(dialog.getByText('50 RU').tagName).toBe('SPAN');
            const toggle = dialog.getByRole('button', { name: 'db/a' });
            await user.click(toggle);
            expect(toggle).toHaveAccessibleName('db/a');
            expect(toggle).toHaveFocus();
            const evidence = dialog.getByRole('region', { name: 'db/a' });
            expect(evidence.textContent).toBe('Peak: 10 RU.');
            expect(within(evidence).getByText('10 RU')).toBeVisible();
            expect(within(evidence).getByText('10 RU')).not.toHaveAttribute('tabindex');
            expect(evidence.querySelector('[aria-live], [role="alert"]')).toBeNull();
        });
    });

    it('renders the serverless check and hides retained superseded findings', async () => {
        showCoverage(
            { available: true },
            {
                advisories: [
                    {
                        id: 'ServerlessThrottling:db/a',
                        rule: 'ServerlessThrottling',
                        severity: 'High',
                        scope: 'db/a',
                        title: 'Serverless request throttling',
                        rationale: '20% of requests were throttled.',
                        suggestedAction: 'Consider provisioned capacity.',
                        thresholdReference: 'At least 1000 requests.',
                    },
                    {
                        id: 'OverProvisioning:db/b',
                        rule: 'OverProvisioning',
                        severity: 'Low',
                        scope: 'db/b',
                        title: 'Superseded sizing advice',
                        rationale: 'Unused capacity.',
                        suggestedAction: 'Lower RU.',
                        thresholdReference: 'Low demand.',
                        supersededBy: 'IdleContainer:db/b',
                    },
                ],
            },
        );
        expect(screen.queryByRole('button', { name: /Over-provisioned throughput/ })).not.toBeInTheDocument();
        const button = screen.getByRole('button', { name: /^Serverless throttling/ });
        expect(button).toHaveTextContent('Serverless throttling');
        expect(button).toHaveAccessibleName(/^Serverless throttling/);
        expect(button).toHaveTextContent(
            'A serverless container is throttling requests. ' +
                'There is no provisioned RU/s setting to raise; consider provisioned capacity for sustained demand.',
        );
        await userEvent.setup().click(button);
        expect(screen.getByRole('dialog')).toHaveTextContent('Consider provisioned capacity.');
    });
});
