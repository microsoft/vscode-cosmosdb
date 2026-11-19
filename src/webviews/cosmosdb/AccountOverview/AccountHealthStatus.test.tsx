/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { badgeClassNames, Button, FluentProvider, tokens, webLightTheme } from '@fluentui/react-components';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type OverviewHealthCheck } from '../../../panels/accountOverview/overviewHealthModel';
import { HEALTH_POLICY } from '../../../panels/accountOverview/services/healthPolicy';
import { HOUR, MINUTE } from '../../../panels/accountOverview/services/units';
import { AccountHealthStatus, healthIndicatorDescriptions } from './AccountHealthStatus';

function Wrapper({ children }: PropsWithChildren) {
    return <FluentProvider theme={webLightTheme}>{children}</FluentProvider>;
}

const initialKind = document.body.getAttribute('data-vscode-theme-kind');

beforeEach(() => {
    vi.spyOn(document.body, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1024, 768));
    vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(function (this: HTMLElement) {
        return this.parentElement;
    });
});

afterEach(() => {
    vi.restoreAllMocks();
    if (initialKind === null) {
        document.body.removeAttribute('data-vscode-theme-kind');
    } else {
        document.body.setAttribute('data-vscode-theme-kind', initialKind);
    }
});

describe('AccountHealthStatus', () => {
    it('keeps the visible health label, one live status and policy-backed check descriptions', async () => {
        const user = userEvent.setup();
        render(
            <AccountHealthStatus
                provisioningState="Succeeded"
                accountHealth="Healthy"
                healthChecks={[{ kind: 'requests', outcome: 'passed', detail: 'clear' }]}
            />,
            { wrapper: Wrapper },
        );
        const badge = screen.getByLabelText('Healthy');
        expect(badge).toHaveTextContent('Healthy');
        expect(badge).toHaveAccessibleName('Healthy');
        expect(badge).toHaveAttribute('tabindex', '0');
        const policy = HEALTH_POLICY.sustainedThrottling;
        const minutes = new Intl.NumberFormat(undefined, { style: 'unit', unit: 'minute', unitDisplay: 'long' }).format(
            policy.minDurationMs / MINUTE,
        );
        const hours = new Intl.NumberFormat(undefined, { style: 'unit', unit: 'hour', unitDisplay: 'long' }).format(
            policy.observation.windowMs / HOUR,
        );
        expect(badge).toHaveAccessibleDescription('Show account health details');
        await user.click(badge);
        const details = screen.getByRole('group', { name: 'Health: Healthy' });
        expect(details).toHaveTextContent(
            `No sustained account-wide 429 rate above ${(policy.shareThreshold * 100).toLocaleString()}% for ${minutes} in the last ${hours}.`,
        );
        const provisioningCheck = within(details).getAllByRole('listitem')[0];
        expect(provisioningCheck).toHaveTextContent('Resource provisioning — Passed');
        expect(provisioningCheck).toHaveTextContent('Resource provisioning state: Online.');
        expect(screen.getAllByRole('status')).toHaveLength(1);
        expect(screen.getByRole('status')).toHaveTextContent('Account health: Healthy');
    });

    it('renders unavailable alert checks without losing a known problem', async () => {
        const user = userEvent.setup();
        render(
            <AccountHealthStatus
                provisioningState="Succeeded"
                accountHealth="Critical"
                activeAlertsUnavailable
                healthChecks={[
                    {
                        kind: 'alerts',
                        outcome: 'unavailable',
                        stale: true,
                        summary: { available: true, totalCount: 1, criticalCount: 1, warningCount: 0, generatedAt: 1 },
                    },
                ]}
            />,
            { wrapper: Wrapper },
        );
        await user.click(screen.getByRole('button', { name: 'Critical' }));
        const alertCheck = within(screen.getByRole('group', { name: 'Health: Critical' })).getAllByRole('listitem')[1];
        expect(alertCheck).toHaveTextContent('Active Azure Monitor alerts — Not assessed');
        expect(alertCheck).toHaveTextContent(
            'Active alerts could not be checked. Previously known problems are retained.',
        );
        expect(screen.getByRole('status')).toHaveTextContent('Account health: Critical');
    });

    it('localizes tab reasons without changing the model severity', () => {
        expect(
            healthIndicatorDescriptions({
                databases: { severity: 'Critical', reasons: [{ kind: 'criticalContainers', count: 2 }] },
                advisories: { severity: 'Needs Attention', reasons: [{ kind: 'warningAlerts' }, { kind: 'advisor' }] },
            }),
        ).toEqual({
            databases: {
                severity: 'Critical',
                description:
                    'Critical containers: 2. Account health is at least Needs Attention. Critical containers appear first in the table.',
            },
            advisories: {
                severity: 'Needs Attention',
                description:
                    'Warning active alerts make account health at least Needs Attention. High-impact Performance or Cost recommendations make account health at least Needs Attention.',
            },
        });
    });

    const checks: OverviewHealthCheck[] = [
        { kind: 'requests', outcome: 'unavailable', detail: 'unavailable', reason: 'rbac' },
        { kind: 'containers', outcome: 'unavailable', critical: 0, warning: 0, unassessed: 1 },
        { kind: 'alerts', outcome: 'unavailable', stale: true },
        { kind: 'advisor', outcome: 'unavailable', detail: 'unavailable' },
    ];

    function renderHealth() {
        render(
            <>
                <AccountHealthStatus provisioningState="Succeeded" healthChecks={checks} />
                <Button>Next</Button>
            </>,
            { wrapper: Wrapper },
        );
        return screen.getByLabelText('Unknown', { selector: `.${badgeClassNames.root}` });
    }

    describe('health details popover', () => {
        it('sizes the scrollable surface to the viewport and exposes the structured checklist', async () => {
            vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(800);
            vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(400);
            const user = userEvent.setup();
            const badge = renderHealth();
            vi.spyOn(badge, 'getBoundingClientRect').mockReturnValue(new DOMRect(24, 100, 64, 20));
            await user.tab();
            expect(badge).toHaveFocus();
            expect(badge).toHaveTextContent('Unknown');
            expect(badge).toHaveAccessibleName('Unknown');
            expect(badge).toHaveAccessibleDescription('Show account health details');
            expect(badge).toHaveAttribute('aria-describedby');
            expect(badge).toHaveAttribute('aria-expanded', 'false');
            expect(screen.queryByRole('group', { name: 'Health: Unknown' })).not.toBeInTheDocument();

            await user.keyboard('{Enter}');
            const details = screen.getByRole('group', { name: 'Health: Unknown' });
            expect(badge).toHaveAttribute('aria-expanded', 'true');
            expect(details).toHaveFocus();
            expect(within(details).getAllByRole('listitem')).toHaveLength(5);
            expect(details).toHaveTextContent(
                /Resource provisioning.*Account-wide throttling.*Container throttling.*Active Azure Monitor alerts.*Azure Advisor.*Extension diagnostics/,
            );
            expect(getComputedStyle(details).maxWidth).toBe('480px');
            expect(getComputedStyle(details).overflowY).toBe('auto');
            await waitFor(() => expect(details.style.maxHeight).not.toBe(''));
            expect(Number.parseFloat(details.style.maxHeight)).toBeGreaterThan(0);
            expect(Number.parseFloat(details.style.maxHeight)).toBeLessThan(400);
        });

        it('opens with Space, stays open while reading, and returns focus on Escape', async () => {
            const user = userEvent.setup();
            const badge = renderHealth();
            await user.tab();
            await user.keyboard(' ');
            const details = screen.getByRole('group', { name: 'Health: Unknown' });
            await user.unhover(badge);
            await user.hover(details);
            await user.unhover(details);
            fireEvent.scroll(document);
            expect(details).toBeVisible();
            expect(details).toHaveFocus();

            await user.keyboard('{Escape}');
            await waitFor(() =>
                expect(screen.queryByRole('group', { name: 'Health: Unknown' })).not.toBeInTheDocument(),
            );
            expect(badge).toHaveFocus();
            expect(badge).toHaveAttribute('aria-expanded', 'false');

            await user.tab();
            expect(screen.getByRole('button', { name: 'Next' })).toHaveFocus();
        });

        it('opens on click and dismisses on an outside click', async () => {
            const user = userEvent.setup();
            const badge = renderHealth();
            await user.click(badge);
            expect(screen.getByRole('group', { name: 'Health: Unknown' })).toHaveFocus();
            await user.click(screen.getByRole('button', { name: 'Next' }));
            await waitFor(() =>
                expect(screen.queryByRole('group', { name: 'Health: Unknown' })).not.toBeInTheDocument(),
            );
            expect(screen.getByRole('button', { name: 'Next' })).toHaveFocus();
        });

        it.each(['vscode-dark', 'vscode-light', 'vscode-high-contrast', 'vscode-high-contrast-light'])(
            'uses the migration help popover appearance in %s',
            async (kind) => {
                document.body.setAttribute('data-vscode-theme-kind', kind);
                const user = userEvent.setup();
                await user.click(renderHealth());
                const details = screen.getByRole('group', { name: 'Health: Unknown' });
                expect(getComputedStyle(details).backgroundColor).toBe(
                    kind === 'vscode-dark' ? tokens.colorNeutralBackgroundStatic : tokens.colorNeutralBackground1,
                );
                expect(getComputedStyle(details).color).toBe(
                    kind === 'vscode-dark'
                        ? tokens.colorNeutralForegroundStaticInverted
                        : tokens.colorNeutralForeground1,
                );
            },
        );

        it('does not add an interactive trigger when there is no explanation', async () => {
            const user = userEvent.setup();
            render(<AccountHealthStatus provisioningState="Succeeded" />, { wrapper: Wrapper });
            const badge = screen.getByLabelText('Unknown', { selector: `.${badgeClassNames.root}` });
            expect(badge).not.toHaveAttribute('tabindex');
            expect(badge).not.toHaveAttribute('role', 'button');
            await user.click(badge);
            expect(screen.queryByRole('group')).not.toBeInTheDocument();
        });
    });

    it('describes significant findings from both recommendation sources independently of account health', () => {
        expect(
            healthIndicatorDescriptions({
                advisories: {
                    severity: 'Needs Attention',
                    reasons: [
                        { kind: 'advisorRecommendations', count: 2 },
                        { kind: 'derivedAdvisories', count: 3 },
                    ],
                },
            }),
        ).toEqual({
            advisories: {
                severity: 'Needs Attention',
                description:
                    'High- or medium-impact Azure Advisor recommendations: 2. ' +
                    'High- or medium-severity derived advisories: 3. These findings do not escalate account health.',
            },
        });
    });
});
