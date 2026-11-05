/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { badgeClassNames, Button, FluentProvider, webLightTheme } from '@fluentui/react-components';
import { createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type PropsWithChildren } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type OverviewHealthCheck } from '../../../panels/accountOverview/overviewHealthModel';
import { HEALTH_POLICY } from '../../../panels/accountOverview/services/healthPolicy';
import { HOUR, MINUTE } from '../../../panels/accountOverview/services/units';
import { AccountHealthStatus, healthIndicatorDescriptions } from './AccountHealthStatus';

function Wrapper({ children }: PropsWithChildren) {
    return <FluentProvider theme={webLightTheme}>{children}</FluentProvider>;
}

afterEach(() => vi.restoreAllMocks());

describe('AccountHealthStatus', () => {
    it('keeps the visible health label, one live status and policy-backed check descriptions', () => {
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
        expect(badge).toHaveAccessibleDescription(
            expect.stringContaining(
                `No sustained account-wide 429 rate above ${(policy.shareThreshold * 100).toLocaleString()}% for ${minutes} in the last ${hours}.`,
            ),
        );
        expect(badge).toHaveAccessibleDescription(
            expect.stringContaining('Resource provisioning — Passed Resource provisioning state: Online.'),
        );
        expect(screen.getAllByRole('status')).toHaveLength(1);
        expect(screen.getByRole('status')).toHaveTextContent('Account health: Healthy');
    });

    it('renders unavailable alert checks without losing a known problem', () => {
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
        expect(screen.getByLabelText('Critical')).toHaveAccessibleDescription(
            expect.stringContaining(
                'Active Azure Monitor alerts — Not assessed Active alerts could not be checked. Previously known problems are retained.',
            ),
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

    describe('tooltip', () => {
        it('sizes the tooltip surface rather than only its contents and keeps the full accessible explanation', async () => {
            vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(800);
            vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(400);
            const user = userEvent.setup();
            const badge = renderHealth();
            vi.spyOn(badge, 'getBoundingClientRect').mockReturnValue(new DOMRect(24, 100, 64, 20));
            await user.tab();
            const tooltip = await screen.findByRole('tooltip');

            expect(badge).toHaveFocus();
            expect(badge).toHaveTextContent('Unknown');
            expect(badge).toHaveAccessibleName('Unknown');
            expect(badge).toHaveAccessibleDescription(
                /Resource provisioning.*Account-wide throttling.*Container throttling.*Active Azure Monitor alerts.*Azure Advisor.*Extension diagnostics/,
            );
            expect(getComputedStyle(tooltip).maxWidth).toBe('480px');
            expect(getComputedStyle(tooltip).overflowY).toBe('auto');
            await waitFor(() => expect(tooltip.style.maxHeight).not.toBe(''));
            expect(Number.parseFloat(tooltip.style.maxHeight)).toBeGreaterThan(0);
            expect(Number.parseFloat(tooltip.style.maxHeight)).toBeLessThan(400);
        });

        it('stays open on pointer leave and page scroll while focused, but closes on Escape or blur', async () => {
            const user = userEvent.setup();
            const badge = renderHealth();
            await user.tab();
            const tooltip = await screen.findByRole('tooltip');
            await user.hover(badge);
            await user.unhover(badge);
            fireEvent.scroll(document);
            await new Promise((resolve) => setTimeout(resolve, 300));
            expect(tooltip).toBeVisible();
            expect(badge).toHaveFocus();

            await user.keyboard('{Escape}');
            await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
            expect(badge).toHaveFocus();

            await user.tab();
            expect(screen.getByRole('button', { name: 'Next' })).toHaveFocus();
            await user.tab({ shift: true });
            await screen.findByRole('tooltip');
            await user.tab();
            await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
        });

        it('allows hovering and scrolling the tooltip without focusing the badge', async () => {
            const user = userEvent.setup();
            const badge = renderHealth();
            await user.hover(badge);
            const tooltip = await screen.findByRole('tooltip');
            await user.hover(tooltip);
            fireEvent.wheel(tooltip, { deltaY: 200 });
            fireEvent.scroll(tooltip);
            await new Promise((resolve) => setTimeout(resolve, 300));
            expect(tooltip).toBeVisible();
            expect(badge).not.toHaveFocus();

            await user.unhover(tooltip);
            await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
        });

        it('scrolls overflowing content with navigation keys without moving focus or scrolling the page', async () => {
            const user = userEvent.setup();
            const badge = renderHealth();
            await user.tab();
            const tooltip = await screen.findByRole('tooltip');
            Object.defineProperties(tooltip, {
                clientHeight: { configurable: true, value: 200 },
                scrollHeight: { configurable: true, value: 600 },
                scrollTop: { configurable: true, value: 100 },
            });
            const scrollTo = vi.fn();
            tooltip.scrollTo = scrollTo;

            for (const [key, top] of [
                ['ArrowDown', 140],
                ['ArrowUp', 60],
                ['PageDown', 300],
                ['PageUp', -100],
                ['Home', 0],
                ['End', 600],
            ] as const) {
                const event = createEvent.keyDown(badge, { key, cancelable: true });
                fireEvent(badge, event);
                expect(event.defaultPrevented).toBe(true);
                expect(scrollTo).toHaveBeenLastCalledWith({ top });
                expect(badge).toHaveFocus();
            }

            scrollTo.mockClear();
            const tab = createEvent.keyDown(badge, { key: 'Tab', cancelable: true });
            fireEvent(badge, tab);
            expect(tab.defaultPrevented).toBe(false);
            expect(scrollTo).not.toHaveBeenCalled();

            Object.defineProperty(tooltip, 'scrollHeight', { configurable: true, value: 200 });
            const pageDown = createEvent.keyDown(badge, { key: 'PageDown', cancelable: true });
            fireEvent(badge, pageDown);
            expect(pageDown.defaultPrevented).toBe(false);
            expect(scrollTo).not.toHaveBeenCalled();
        });

        it('does not open a tooltip or add a tab stop when there is no explanation', async () => {
            const user = userEvent.setup();
            render(<AccountHealthStatus provisioningState="Succeeded" />, { wrapper: Wrapper });
            const badge = screen.getByLabelText('Unknown', { selector: `.${badgeClassNames.root}` });
            expect(badge).not.toHaveAttribute('tabindex');
            await user.hover(badge);
            await new Promise((resolve) => setTimeout(resolve, 300));
            expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
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
