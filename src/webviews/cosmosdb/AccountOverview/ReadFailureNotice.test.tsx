/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    READ_PERMISSIONS,
    type ReadFailure,
    type ReadSource,
} from '../../../panels/accountOverview/accessRequirements';
import { DashboardActionsProvider } from './DashboardChrome';
import { ReadFailureNotice } from './ReadFailureNotice';

afterEach(cleanup);

function show(failures: ReadFailure[]) {
    const showOutput = vi.fn();
    const openUrl = vi.fn();
    render(
        <FluentProvider theme={webLightTheme}>
            <DashboardActionsProvider value={{ showOutput, openUrl, reportEvent: vi.fn() }}>
                <ReadFailureNotice failures={failures} />
            </DashboardActionsProvider>
        </FluentProvider>,
    );
    return { showOutput, openUrl };
}

function expandNotice() {
    fireEvent.click(screen.getByRole('button', { name: 'Some account data could not be loaded' }));
}

describe('read failure guidance', () => {
    it.each([
        ['noData', 'rbac'],
        ['rbac', 'noData'],
    ] as const)('preserves permission guidance alongside incomplete data in order %j', (first, second) => {
        const failures: ReadFailure[] = [first, second, first].map((reason) => ({
            source: 'logs',
            kind: 'partialFailure',
            reason,
        }));
        show(failures);
        expandNotice();
        expect(screen.getAllByText('Log Analytics')).toHaveLength(2);
        expect(screen.getByText(/Access denied/)).toBeVisible();
        expect(screen.getByText(/This is not evidence that no data exists/)).toBeVisible();
        expect(screen.getByText(READ_PERMISSIONS.logs[0])).toBeVisible();
    });
    it.each(Object.keys(READ_PERMISSIONS) as ReadSource[])('shows permissions and Output for %s', (source) => {
        show([{ source, kind: 'accessDenied', reason: 'rbac' }]);
        expect(screen.getByRole('group', { name: 'Some account data could not be loaded' })).toBeInTheDocument();
        expandNotice();
        for (const permission of READ_PERMISSIONS[source]) {
            expect(screen.getByText(permission)).toBeInTheDocument();
        }
        const output = screen.getByRole('button', { name: 'Show Output' });
        expect(output).toHaveTextContent('Show Output');
        expect(output).toHaveAccessibleName('Show Output');
    });

    it.each(['{Enter}', ' '])(
        'expands details with %s and opens Output without overriding visible accessible names',
        async (key) => {
            const user = userEvent.setup();
            const { showOutput } = show([{ source: 'metrics', kind: 'accessDenied', reason: 'rbac' }]);
            const toggle = screen.getByRole('button', { name: 'Some account data could not be loaded' });
            expect(toggle).toHaveTextContent('Some account data could not be loaded');
            expect(toggle).toHaveAccessibleName('Some account data could not be loaded');
            expect(toggle).toHaveAttribute('aria-expanded', 'false');
            expect(screen.queryByRole('list')).not.toBeInTheDocument();
            await user.tab();
            expect(toggle).toHaveFocus();
            await user.keyboard(key);
            expect(toggle).toHaveAttribute('aria-expanded', 'true');
            expect(screen.getByText(READ_PERMISSIONS.metrics[0])).toBeVisible();
            await user.tab();
            expect(screen.getByRole('button', { name: 'Show Output' })).toHaveFocus();
            await user.keyboard('{Enter}');
            expect(showOutput).toHaveBeenCalledOnce();
        },
    );

    it('keeps Output and role guidance available while diagnostic details are collapsed', async () => {
        const user = userEvent.setup();
        const { showOutput, openUrl } = show([{ source: 'metrics', kind: 'accessDenied', reason: 'rbac' }]);
        const toggle = screen.getByRole('button', { name: 'Some account data could not be loaded' });
        await user.click(screen.getByRole('button', { name: 'Show Output' }));
        await user.click(screen.getByRole('button', { name: 'Learn more about Azure roles' }));
        expect(showOutput).toHaveBeenCalledOnce();
        expect(openUrl).toHaveBeenCalledWith('https://learn.microsoft.com/azure/role-based-access-control/overview');
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByRole('list')).not.toBeInTheDocument();
    });

    it('describes account-scoped roles and the broader subscription option separately', () => {
        show([
            { source: 'metrics', kind: 'accessDenied', reason: 'rbac' },
            { source: 'activityLog', kind: 'accessDenied', reason: 'rbac' },
        ]);
        expandNotice();
        expect(screen.getByText(/Reader or Monitoring Reader on this Cosmos DB account/)).toBeInTheDocument();
        expect(
            screen.getByText(/Subscription-scoped Reader or Monitoring Reader is a broad option/),
        ).toBeInTheDocument();
    });

    it('explains workspace-mode and table restrictions instead of always requiring Log Analytics Reader', () => {
        show([{ source: 'logs', kind: 'accessDenied', reason: 'rbac' }]);
        expandNotice();
        expect(screen.getByText(/Resource-context queries normally use Reader on this account/)).toBeInTheDocument();
        expect(screen.getByText(/If the workspace requires workspace permissions/)).toBeInTheDocument();
        expect(
            screen.getByText(/CDBDataPlaneRequests5M, CDBDataPlaneRequests and CDBQueryRuntimeStatistics/),
        ).toBeInTheDocument();
    });

    it('asks for sign-in rather than role grants on authentication failures', () => {
        show([{ source: 'metrics', kind: 'authentication', reason: 'rbac' }]);
        expandNotice();
        expect(screen.getByText(/Sign-in required/)).toBeInTheDocument();
        expect(screen.queryByText(READ_PERMISSIONS.metrics[0])).not.toBeInTheDocument();
        expect(screen.queryByText(/Ask for Reader/)).not.toBeInTheDocument();
    });

    it('does not confuse a failed request with an empty dataset or missing roles', () => {
        show([{ source: 'metrics', kind: 'transient', reason: 'noData' }]);
        expandNotice();
        expect(screen.getByText(/This is not evidence that no data exists/)).toBeInTheDocument();
        expect(screen.queryByText(READ_PERMISSIONS.metrics[0])).not.toBeInTheDocument();
    });

    it('deduplicates repeated source categories and remains absent after successful reads', () => {
        show([]);
        expect(screen.queryByRole('button', { name: 'Show Output' })).not.toBeInTheDocument();
        cleanup();
        const failure: ReadFailure = { source: 'metrics', kind: 'accessDenied', reason: 'rbac' };
        show([failure, failure]);
        expandNotice();
        expect(screen.getAllByText('Azure Monitor metrics')).toHaveLength(1);
    });
});
