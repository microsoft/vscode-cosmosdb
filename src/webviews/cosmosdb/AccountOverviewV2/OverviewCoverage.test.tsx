/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { act, cleanup, fireEvent, render as renderComponent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ComponentProps, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DIAGNOSTIC_SETTINGS_URL, RBAC_LEARN_MORE_URL } from '../AccountOverview/DashboardChrome';
import { OverviewCoverage } from './OverviewCoverage';

beforeEach(() => {
    const matches = Element.prototype.matches;
    // Floating UI checks :modal during positioning. jsdom has no modal top layer, and nwsapi's native-state
    // fallback recurses through Element.matches. These inline popovers are not modal; keep all other selectors real.
    vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, selector: string) {
        return selector === ':modal' ? false : matches.call(this, selector);
    });

    // Tabster treats a zero-size body and null offsetParent as hidden. Supply jsdom's missing layout primitives,
    // retaining display:none checks so keyboard navigation still skips hidden controls.
    vi.spyOn(document.body, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1024, 768));
    vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(function (this: HTMLElement) {
        if (getComputedStyle(this).display === 'none') {
            return null;
        }
        for (let element = this.parentElement; element; element = element.parentElement) {
            if (getComputedStyle(element).display === 'none') {
                return null;
            }
        }
        return this.parentElement;
    });
});

afterEach(async () => {
    await act(async () => cleanup());
    vi.restoreAllMocks();
    vi.useRealTimers();
});

function render(element: ReactElement) {
    return renderComponent(element, {
        wrapper: ({ children }) => <FluentProvider theme={webLightTheme}>{children}</FluentProvider>,
    });
}

function overview(): ComponentProps<typeof OverviewCoverage>['overview'] {
    return {
        alertTimeRange: '1d',
        alerts: { available: true, alerts: [], criticalCount: 0, warningCount: 0, timeRange: '1d', generatedAt: 1 },
        derivedAdvisories: { available: true, advisories: [], generatedAt: 1 },
        recommendations: { available: true, recommendations: [], hasHighImpactPerfCost: false, generatedAt: 1 },
        alertsLoading: false,
        derivedLoading: false,
        recommendationsLoading: false,
        refresh: vi.fn(),
        handleOpenUrl: vi.fn(),
    };
}

describe('Preview source availability pills', () => {
    it('shows no warning for available sources and keeps the two categories independent', () => {
        const o = overview();
        o.recommendations!.available = false;
        o.recommendations!.reason = 'rbac';
        const { rerender } = render(<OverviewCoverage overview={o} section="findings" />);
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
        rerender(<OverviewCoverage overview={o} section="recommendations" />);
        expect(screen.getByRole('button', { name: 'Azure Advisor: missing access' })).toHaveAccessibleDescription(
            'Not enough permissions: your role is missing Reader on the subscription.',
        );
    });

    it('opens role guidance on hover and keeps the action reachable in the popup', () => {
        vi.useFakeTimers();
        const o = overview();
        o.alerts!.available = false;
        o.alerts!.reason = 'rbac';
        render(<OverviewCoverage overview={o} section="findings" />);
        const pill = screen.getByRole('button', { name: 'Azure alerts: missing access' });
        expect(pill).toHaveTextContent('Azure alerts: missing access');
        expect(pill).toHaveAccessibleName('Azure alerts: missing access');
        expect(pill).toHaveAccessibleDescription('Not enough permissions: your role is missing Monitoring Reader.');
        expect(screen.queryByText('Learn more about Azure roles')).not.toBeInTheDocument();
        fireEvent.mouseEnter(pill);
        const popup = screen.getByRole('group', { name: 'Azure alerts: missing access' });
        const action = screen.getByRole('button', { name: 'Learn more about Azure roles' });
        expect(document.body).toHaveFocus();
        fireEvent.mouseLeave(pill);
        fireEvent.mouseEnter(popup);
        act(() => vi.advanceTimersByTime(500));
        expect(popup).toBeVisible();
        expect(document.body).toHaveFocus();
        fireEvent.click(action);
        expect(o.handleOpenUrl).toHaveBeenCalledExactlyOnceWith(RBAC_LEARN_MORE_URL);
        fireEvent.mouseLeave(popup);
        act(() => vi.advanceTimersByTime(500));
        expect(popup).not.toBeInTheDocument();
    });

    it.each(['unavailable', 'loading', 'not loaded', 'logs disabled', 'missing log access'] as const)(
        'shares tier-1 coverage but not health-only log coverage when derived checks are %s',
        (state) => {
            const o = overview();
            switch (state) {
                case 'unavailable':
                    o.derivedAdvisories!.available = false;
                    o.derivedAdvisories!.reason = 'rbac';
                    break;
                case 'loading':
                    o.derivedLoading = true;
                    break;
                case 'not loaded':
                    o.derivedAdvisories = undefined;
                    break;
                case 'logs disabled':
                    o.derivedAdvisories!.logSource = { available: false, reason: 'logAnalyticsDisabled' };
                    break;
                case 'missing log access':
                    o.derivedAdvisories!.logSource = { available: false, reason: 'rbac' };
                    break;
            }
            const { rerender } = render(<OverviewCoverage overview={o} section="findings" />);
            expect(screen.getAllByRole('button')).toHaveLength(1);
            rerender(<OverviewCoverage overview={o} section="recommendations" />);
            const derivedPill =
                state === 'unavailable'
                    ? 'Derived checks: missing access'
                    : state === 'loading'
                      ? 'Derived checks: updating'
                      : state === 'not loaded'
                        ? 'Derived checks: not loaded'
                        : undefined;
            expect(screen.queryAllByRole('button').map((button) => button.textContent)).toEqual(
                derivedPill ? [derivedPill] : [],
            );
            expect(screen.queryByRole('button', { name: /Log-based checks/ })).not.toBeInTheDocument();
            rerender(<OverviewCoverage overview={{ ...o, recommendationsLoading: true }} section="recommendations" />);
            expect(screen.getAllByRole('button')).toHaveLength(derivedPill ? 2 : 1);
            expect(screen.getByRole('button', { name: 'Azure Advisor: updating' })).toHaveAccessibleDescription(
                'Updating; any displayed findings are from the previous snapshot.',
            );
            rerender(
                <OverviewCoverage
                    overview={{ ...o, recommendations: { ...o.recommendations!, available: false, reason: 'rbac' } }}
                    section="recommendations"
                />,
            );
            expect(screen.getAllByRole('button')).toHaveLength(derivedPill ? 2 : 1);
            expect(screen.getByRole('button', { name: 'Azure Advisor: missing access' })).toHaveAccessibleDescription(
                'Not enough permissions: your role is missing Reader on the subscription.',
            );
        },
    );

    it('supports keyboard opening, actionable guidance and Escape dismissal', async () => {
        const user = userEvent.setup();
        const o = overview();
        o.derivedAdvisories!.logSource = { available: false, reason: 'logAnalyticsDisabled' };
        render(<OverviewCoverage overview={o} section="findings" />);
        const pill = screen.getByRole('button', { name: 'Log-based checks: logs disabled' });
        expect(pill).toHaveAttribute('aria-expanded', 'false');
        await user.tab();
        expect(pill).toHaveFocus();
        await user.keyboard('{Enter}');
        const popup = await screen.findByRole('group', { name: 'Log-based checks: logs disabled' });
        expect(pill).toHaveAttribute('aria-expanded', 'true');
        expect(popup).toBeVisible();
        const action = within(popup).getByRole('button', { name: 'Learn how to enable diagnostic settings' });
        expect(pill).toHaveFocus();
        expect(action).toHaveTextContent('Learn how to enable diagnostic settings');
        expect(action).toHaveAccessibleName('Learn how to enable diagnostic settings');
        await user.tab();
        expect(action).toHaveFocus();
        await user.keyboard('{Enter}');
        expect(o.handleOpenUrl).toHaveBeenCalledExactlyOnceWith(DIAGNOSTIC_SETTINGS_URL);
        await user.keyboard('{Escape}');
        expect(screen.queryByRole('group', { name: 'Log-based checks: logs disabled' })).not.toBeInTheDocument();
        expect(pill).toHaveAttribute('aria-expanded', 'false');
        expect(pill).toHaveFocus();
    });

    it('names Log Analytics Reader without hiding the available derived source', () => {
        const o = overview();
        o.derivedAdvisories!.logSource = { available: false, reason: 'rbac' };
        render(<OverviewCoverage overview={o} section="findings" />);
        expect(screen.getAllByRole('button')).toHaveLength(1);
        expect(screen.getByRole('button', { name: 'Log-based checks: missing access' })).toHaveAccessibleDescription(
            'Not enough permissions: your role is missing Log Analytics Reader.',
        );
    });

    it('distinguishes loading, unsupported, missing and no-data states with appropriate actions', () => {
        const o = overview();
        o.alerts!.available = false;
        o.alerts!.reason = 'noData';
        const { rerender } = render(<OverviewCoverage overview={o} section="findings" />);
        fireEvent.click(screen.getByRole('button', { name: 'Azure alerts: unavailable' }));
        fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
        expect(o.refresh).toHaveBeenCalledOnce();
        fireEvent.keyDown(screen.getByRole('button', { name: 'Refresh' }), { key: 'Escape' });
        rerender(<OverviewCoverage overview={{ ...o, alertsLoading: true }} section="findings" />);
        expect(screen.getByRole('button', { name: 'Azure alerts: updating' })).toHaveAccessibleDescription(
            'Updating; any displayed findings are from the previous snapshot.',
        );
        rerender(
            <OverviewCoverage
                overview={{ ...o, alerts: { ...o.alerts!, reason: 'unsupported' } }}
                section="findings"
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Azure alerts: unsupported' }));
        expect(screen.queryByRole('button', { name: 'Refresh' })).not.toBeInTheDocument();
        fireEvent.keyDown(screen.getByRole('button', { name: 'Azure alerts: unsupported' }), { key: 'Escape' });
        rerender(<OverviewCoverage overview={{ ...o, alerts: undefined }} section="findings" />);
        expect(screen.getByRole('button', { name: 'Azure alerts: not loaded' })).toBeVisible();
    });

    it('does not represent an old alert window as current availability', () => {
        const o = overview();
        o.alerts!.timeRange = '7d';
        render(<OverviewCoverage overview={o} section="findings" />);
        expect(screen.getByRole('button', { name: 'Azure alerts: not loaded' })).toBeVisible();
    });
});
