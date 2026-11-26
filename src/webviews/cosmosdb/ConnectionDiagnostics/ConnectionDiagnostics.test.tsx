/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { AriaLiveAnnouncer, FluentProvider, webLightTheme } from '@fluentui/react-components';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type PropsWithChildren } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, expect, it, onTestFinished, vi } from 'vitest';
import { type DiagnosticsState } from '../../../connectionDiagnostics/model';
import { render as renderWebview } from '../../index';
import { ConnectionDiagnostics } from './ConnectionDiagnostics';

const client = vi.hoisted(() => ({
    state: { query: vi.fn() },
    rerun: { mutate: vi.fn() },
    cancel: { mutate: vi.fn() },
    showReport: { mutate: vi.fn() },
    copy: { mutate: vi.fn() },
    save: { mutate: vi.fn() },
    showOutput: { mutate: vi.fn() },
    openHelp: { mutate: vi.fn() },
    addDataRole: { mutate: vi.fn() },
}));
vi.mock('@microsoft/vscode-ext-webview/react', () => ({
    useTrpcClient: () => client,
    WithWebviewContext: ({ children }: PropsWithChildren) => children,
}));
vi.mock('react-dom/client', { spy: true });

beforeEach(() => vi.resetAllMocks());

const completed: DiagnosticsState = {
    kind: 'attached',
    connectionName: 'Saved account',
    phase: 'completed',
    checks: [
        { step: 'target', status: 'passed', finding: 'endpointReady' },
        {
            step: 'access',
            status: 'failed',
            finding: 'firewallPublic',
            auth: 'entra',
            observedClientIp: '203.0.113.45',
        },
    ],
    trace: { runId: 'local-run-id', lines: [], checkDurations: { access: 120 } },
};
const running: DiagnosticsState = {
    kind: 'attached',
    phase: 'running',
    active: 'access',
    checks: [{ step: 'target', status: 'passed', finding: 'endpointReady' }],
};

function renderPanel() {
    return render(
        <FluentProvider theme={webLightTheme}>
            <AriaLiveAnnouncer>
                <ConnectionDiagnostics />
            </AriaLiveAnnouncer>
        </FluentProvider>,
    );
}

function mockFocusableLayout() {
    // Tabster needs visible bounds and an offset parent, neither of which jsdom provides.
    const bounds = vi.spyOn(document.body, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1024, 768));
    const offsetParent = vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(function (
        this: HTMLElement,
    ) {
        return this.parentElement;
    });
    onTestFinished(() => {
        bounds.mockRestore();
        offsetParent.mockRestore();
    });
}

it('does not autofocus the scroll region on webview mount but keeps it keyboard reachable', async () => {
    mockFocusableLayout();
    client.state.query.mockResolvedValue(completed);
    const container = document.createElement('div');
    container.id = 'diagnostics-root';
    document.body.append(container);
    vi.stubGlobal('l10n_bundle', {});
    onTestFinished(() => {
        const root = vi.mocked(createRoot).mock.results[0]?.value;
        act(() => root?.unmount());
        container.remove();
        vi.unstubAllGlobals();
    });

    renderWebview(
        'cosmosDbConnectionDiagnostics',
        { postMessage: vi.fn(), getState: () => undefined, setState: (state) => state },
        container.id,
    );
    const heading = await screen.findByRole('heading', { name: 'Connection Diagnostics' });
    const scrollRegion = screen.getByRole('region', { name: heading.textContent ?? undefined });
    expect(scrollRegion).toContainElement(heading);
    expect(document.body).toHaveFocus();

    const action = await screen.findByRole('button', { name: 'Configure the Cosmos DB IP firewall' });
    const user = userEvent.setup();
    await user.tab();
    expect(scrollRegion).toHaveFocus();
    await user.tab();
    expect(action).toHaveFocus();
});

it('announces a step once across repeated polls, then announces the outcome once', async () => {
    const announce = vi.fn<(message: string) => void>();
    const original = Object.getOwnPropertyDescriptor(document, 'ariaNotify');
    Object.defineProperty(document, 'ariaNotify', { configurable: true, value: announce });
    onTestFinished(() => {
        if (original) Object.defineProperty(document, 'ariaNotify', original);
        else Reflect.deleteProperty(document, 'ariaNotify');
    });
    client.state.query
        .mockResolvedValueOnce(running)
        .mockResolvedValueOnce({ ...running })
        .mockResolvedValue(completed);
    renderPanel();

    const outcome = 'Could not verify Cosmos DB data-plane access.';
    await screen.findByRole('region', { name: outcome });
    await waitFor(() => expect(announce).toHaveBeenCalledWith(expect.stringContaining(outcome), expect.anything()));
    const messages = announce.mock.calls.map(([message]) => message);
    expect(messages.filter((message) => message === 'Checking: Cosmos DB data-plane access')).toHaveLength(1);
    expect(messages.filter((message) => message.includes(outcome))).toHaveLength(1);
});

it('shows the outcome and check findings without a disclosure', async () => {
    client.state.query.mockResolvedValue({ ...completed, finishedAt: Date.now() });
    renderPanel();
    const summary = await screen.findByRole('region', { name: 'Could not verify Cosmos DB data-plane access.' });
    expect(screen.getByRole('heading', { name: 'Connection Diagnostics' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Saved account' })).toBeVisible();
    expect(screen.getByText('Checked a few seconds ago')).toBeVisible();
    expect(within(summary).queryByText(/Check public network access and the IP allowlist/)).not.toBeInTheDocument();
    expect(within(summary).getByText(/Contacting support\?/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Add Data Contributor role' })).not.toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Connection checks' });
    expect(within(list).queryByRole('button', { name: /Details for/ })).not.toBeInTheDocument();
    expect(within(list).getByText('Outgoing IP reported by Cosmos DB: 203.0.113.45')).toBeVisible();
    expect(within(list).getByText(/Authentication method: Microsoft Entra ID/)).toBeVisible();
    expect(within(list).getByText(/Check public network access and the IP allowlist/)).toBeVisible();
    expect(within(list).getByText('120 ms')).toBeVisible();
    expect(within(list).getByRole('img', { name: 'Passed' })).toBeVisible();
    expect(within(list).getByRole('img', { name: 'Failed' })).toBeVisible();
    expect(within(list).getByText('Not run')).not.toHaveAttribute('aria-hidden');
});

it('keeps Overview permissions separate from successful data-plane access', async () => {
    client.state.query.mockResolvedValue({
        ...completed,
        kind: 'azure',
        checks: [
            { step: 'access', finding: 'connected', status: 'passed' },
            { step: 'metrics', finding: 'overviewDenied', status: 'info' },
            { step: 'queryLogs', finding: 'overviewLogsMissing', status: 'info' },
        ],
    } satisfies DiagnosticsState);
    client.openHelp.mutate.mockResolvedValue(true);
    const user = userEvent.setup();
    renderPanel();

    expect(await screen.findByRole('region', { name: 'Cosmos DB data-plane access verified.' })).toBeVisible();
    const checks = within(screen.getByRole('list', { name: 'Account Overview access' }));
    expect(checks.getByText(/Monitoring Reader/)).toBeVisible();
    expect(checks.getByText('Required diagnostic category: QueryRuntimeStatistics.', { exact: false })).toBeVisible();
    const help = within(checks.getByRole('group', { name: 'Azure Monitor metrics' })).getByRole('button', {
        name: 'Review Azure Monitor permissions',
    });
    expect(help).toHaveTextContent('Review Azure Monitor permissions');
    expect(help).toHaveAccessibleName('Review Azure Monitor permissions');
    help.focus();
    await user.keyboard('{Enter}');
    expect(client.openHelp.mutate).toHaveBeenCalledExactlyOnceWith('monitorAccess');
    expect(screen.queryByRole('button', { name: 'Add Data Contributor role' })).not.toBeInTheDocument();
});

it('distinguishes an ARM read from a data-plane firewall denial without showing a redundant DNS step', async () => {
    client.state.query.mockResolvedValue({
        ...completed,
        kind: 'azure',
        checks: [
            {
                step: 'accountSettings',
                status: 'passed',
                finding: 'settingsRead',
                network: {
                    publicAccess: 'enabled',
                    ipRules: 6,
                    vnetFilterEnabled: false,
                    vnetRules: 0,
                    privateEndpoints: 0,
                    localAuthDisabled: true,
                },
            },
            { step: 'access', status: 'failed', finding: 'firewallUnknown', auth: 'entra' },
        ],
    } satisfies DiagnosticsState);
    client.openHelp.mutate.mockResolvedValueOnce(false);
    const user = userEvent.setup();
    renderPanel();
    const summary = await screen.findByRole('region', { name: 'Could not verify Cosmos DB data-plane access.' });
    expect(within(summary).queryByText(/Control-plane access was verified through Azure Resource Manager/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add Data Contributor role' })).not.toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Connection checks' });
    expect(screen.getByText(/does not tell you whether your identity has a data role/)).toBeVisible();
    const docs = screen.getByRole('button', { name: 'Troubleshoot Cosmos DB HTTP 403' });
    const access = within(list).getByText('Cosmos DB data-plane access').closest('li');
    expect(access).toContainElement(docs);
    expect(summary).not.toContainElement(docs);
    docs.focus();
    await user.keyboard('{Enter}');
    expect(client.openHelp.mutate).toHaveBeenCalledExactlyOnceWith('forbidden');
    const feedback = await screen.findByRole('alert');
    expect(feedback).toHaveTextContent('Could not open the troubleshooting documentation in your browser.');
    expect(access).toContainElement(feedback);
    expect(docs).toHaveFocus();

    expect(within(list).getByText('Azure account settings (control plane)')).toBeVisible();
    expect(within(list).getByText(/Control-plane access was verified through Azure Resource Manager/)).toBeVisible();
    expect(within(list).getByText(/Public network access: Enabled/)).toBeVisible();
    expect(within(list).getByText(/IP rules: 6/)).toBeVisible();
    expect(within(list).queryByText('Server address (DNS)')).not.toBeInTheDocument();
});

it.each(['click', 'Enter', 'Space'])('opens documentation once via the host on %s', async (activation) => {
    const nativeOpen = vi.fn();
    const handleWebviewClick = (event: MouseEvent) => {
        // VS Code handles anchor clicks even if React has already called preventDefault().
        for (const element of event.composedPath()) {
            if (element instanceof HTMLAnchorElement && element.href) {
                nativeOpen(element.href);
                event.preventDefault();
                break;
            }
        }
    };
    window.addEventListener('click', handleWebviewClick);
    onTestFinished(() => window.removeEventListener('click', handleWebviewClick));
    client.state.query.mockResolvedValue(completed);
    client.openHelp.mutate.mockResolvedValue(true);
    const user = userEvent.setup();
    renderPanel();
    const label = 'Troubleshoot Cosmos DB HTTP 403';
    const docs = await screen.findByRole('button', { name: label });
    expect(docs).toHaveTextContent(label);
    if (activation === 'click') {
        await user.click(docs);
    } else {
        docs.focus();
        await user.keyboard(activation === 'Enter' ? '{Enter}' : ' ');
    }
    expect(nativeOpen).not.toHaveBeenCalled();
    expect(client.openHelp.mutate).toHaveBeenCalledExactlyOnceWith('forbidden');
    expect(docs).toHaveAccessibleName(label);
});

it('shows the name-resolution evidence when the DNS check ran', async () => {
    client.state.query.mockResolvedValue({
        ...completed,
        checks: [
            { step: 'target', status: 'passed', finding: 'endpointReady' },
            { step: 'access', status: 'skipped', finding: 'apiProbeUnavailable' },
            { step: 'dns', status: 'passed', finding: 'publicDns' },
        ],
    } satisfies DiagnosticsState);
    renderPanel();
    const list = await screen.findByRole('list', { name: 'Connection checks' });
    await within(list).findByText('Server address (DNS)');
    expect(within(list).getByRole('img', { name: 'Skipped' })).toBeVisible();
    expect(within(list).getByText(/This is expected for public access/)).toBeVisible();
    expect(within(list).getByText(/DNS does not show which route the SDK used/)).toBeVisible();
});

it.each([undefined, 'container'] as const)(
    'groups role actions under the access check and restores focus (scope: %s)',
    async (scope) => {
        client.state.query.mockResolvedValue({
            ...completed,
            kind: 'azure',
            scope,
            canAddDataRole: true,
            checks: [
                { step: 'access', status: 'info', finding: 'dataRbac', auth: 'entra' },
                ...(scope ? [{ step: 'query', status: 'skipped', finding: 'queryNotRun' } as const] : []),
            ],
        } satisfies DiagnosticsState);
        client.addDataRole.mutate.mockResolvedValueOnce('cancelled').mockResolvedValueOnce('assigned');
        const user = userEvent.setup();
        renderPanel();

        const summary = await screen.findByRole('region', { name: 'Cosmos DB data role required.' });
        expect(screen.getByText(/The identity lacks Cosmos DB data-plane permissions/)).toBeVisible();
        const checks = within(screen.getByRole('list', { name: 'Connection checks' }));
        const queryRow = expect.stringContaining('Selected container query');
        expect(checks.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
            expect.stringContaining('Azure account settings (control plane)'),
            expect.stringContaining('Connection endpoint'),
            expect.stringContaining('Cosmos DB data-plane access'),
            ...(scope ? [queryRow] : []),
        ]);
        expect(
            within(summary).queryByText(/The identity lacks Cosmos DB data-plane permissions/),
        ).not.toBeInTheDocument();
        const row = screen.getByText('Cosmos DB data-plane access').closest('li');
        const actions = screen.getByRole('group', { name: 'Cosmos DB data-plane access' });
        const add = within(actions).getByRole('button', { name: 'Add Data Contributor role' });
        const docs = within(actions).getByRole('button', { name: 'Learn about Cosmos DB data-plane roles' });
        expect(row).toContainElement(actions);
        expect(add).toHaveTextContent('Add Data Contributor role');
        expect(docs).toHaveTextContent('Learn about Cosmos DB data-plane roles');
        expect(add).toHaveAccessibleName('Add Data Contributor role');
        expect(docs).toHaveAccessibleName('Learn about Cosmos DB data-plane roles');
        expect(summary).not.toContainElement(add);
        expect(summary).not.toContainElement(docs);
        add.focus();
        await user.keyboard('{Enter}');
        expect(client.addDataRole.mutate).toHaveBeenCalledExactlyOnceWith({ runId: completed.trace?.runId });
        expect(add).toHaveFocus();
        await user.keyboard('{Enter}');
        const feedback = await screen.findByText(/Role assigned\. Wait for the permission/);
        expect(feedback).toBeVisible();
        expect(row).toContainElement(feedback);
        expect(add).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Re-run' })).toHaveFocus();
    },
);

it('shows progress, preserves button focus, and can cancel and rerun', async () => {
    const cancelled: DiagnosticsState = { kind: 'attached', phase: 'cancelled', checks: [] };
    client.state.query.mockResolvedValueOnce(completed).mockResolvedValue(running);
    client.rerun.mutate.mockResolvedValue(running);
    client.cancel.mutate.mockImplementation(() => {
        client.state.query.mockResolvedValue(cancelled);
    });
    const user = userEvent.setup();
    renderPanel();
    await screen.findByRole('region', { name: 'Could not verify Cosmos DB data-plane access.' });
    const rerun = screen.getByRole('button', { name: 'Re-run' });
    expect(rerun).toHaveTextContent('Re-run');
    expect(rerun).toHaveAccessibleName('Re-run');
    await user.click(rerun);
    await screen.findByText('Checking the connection…');
    expect(client.rerun.mutate).toHaveBeenCalledOnce();

    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(cancel).toHaveTextContent('Cancel');
    expect(cancel).toHaveAccessibleName('Cancel');
    expect(cancel).toHaveFocus();
    const list = screen.getByRole('list', { name: 'Connection checks' });
    expect(within(list).getByText('Cosmos DB data-plane access').closest('li')).toHaveAttribute('aria-current', 'step');
    expect(within(list).getByRole('img', { name: 'Checking' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Share report' })).not.toBeInTheDocument();
    await user.click(cancel);
    await screen.findByRole('region', { name: 'Connection diagnostics cancelled.' });
    expect(client.cancel.mutate).toHaveBeenCalledOnce();
    expect(rerun).toHaveFocus();
    expect(within(list).getAllByText('Not run')).toHaveLength(3);
});

it('opens the report in the editor through the host and offers copy and save', async () => {
    mockFocusableLayout();
    client.state.query.mockResolvedValue(completed);
    client.copy.mutate.mockResolvedValue('done');
    client.save.mutate.mockResolvedValue('done');
    client.showReport.mutate.mockResolvedValue('done');
    const user = userEvent.setup();
    renderPanel();

    const showReport = await screen.findByRole('button', { name: 'Show report' });
    expect(showReport).toHaveTextContent('Show report');
    expect(showReport).toHaveAccessibleName('Show report');
    showReport.focus();
    await user.keyboard('{Enter}');
    expect(client.showReport.mutate).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    const share = screen.getByRole('button', { name: 'Share report' });
    expect(screen.getByRole('group', { name: 'Diagnostics actions' })).toContainElement(share);
    expect(share).toHaveTextContent('Share report');
    expect(share).toHaveAccessibleName('Share report');
    share.focus();
    await user.keyboard('{Enter}');
    const copy = await screen.findByRole('menuitem', { name: 'Copy report to clipboard' });
    expect(copy).toHaveTextContent('Copy report to clipboard');
    expect(copy).toHaveAccessibleName('Copy report to clipboard');
    await waitFor(() => expect(copy).toHaveFocus());
    await user.keyboard('{Escape}');
    await waitFor(() => expect(share).toHaveFocus());
    await user.keyboard('{Enter}');
    const reopenedCopy = await screen.findByRole('menuitem', { name: 'Copy report to clipboard' });
    await waitFor(() => expect(reopenedCopy).toHaveFocus());
    await user.keyboard('{Enter}');
    expect(client.copy.mutate).toHaveBeenCalledOnce();
    expect(await screen.findByText('Diagnostics report copied.')).toBeVisible();

    await user.click(share);
    const save = await screen.findByRole('menuitem', { name: 'Save report to file…' });
    expect(save).toHaveTextContent('Save report to file…');
    expect(save).toHaveAccessibleName('Save report to file…');
    await user.click(save);
    expect(client.save.mutate).toHaveBeenCalledOnce();
    expect(await screen.findByText('Diagnostics report saved.')).toBeVisible();
});

it('opens the local Output channel using a control with its visible accessible name', async () => {
    client.state.query.mockResolvedValue(completed);
    const user = userEvent.setup();
    renderPanel();
    const output = screen.getByRole('button', { name: 'Show Output' });
    expect(output).toHaveTextContent('Show Output');
    expect(output).toHaveAccessibleName('Show Output');
    output.focus();
    await user.keyboard('{Enter}');
    expect(client.showOutput.mutate).toHaveBeenCalledOnce();
});

it('can refresh after a status request failure without starting another diagnosis', async () => {
    client.state.query.mockRejectedValueOnce(new Error('status unavailable')).mockResolvedValue(completed);
    const user = userEvent.setup();
    renderPanel();
    expect(await screen.findByText('Could not update connection diagnostics.')).toBeVisible();
    const refresh = screen.getByRole('button', { name: 'Refresh status' });
    expect(refresh).toHaveTextContent('Refresh status');
    expect(refresh).toHaveAccessibleName('Refresh status');
    await user.click(refresh);
    expect(await screen.findByRole('region', { name: 'Could not verify Cosmos DB data-plane access.' })).toBeVisible();
    expect(client.rerun.mutate).not.toHaveBeenCalled();
});

it('keeps results visible and reports a failed export without treating dismissal as an error', async () => {
    client.state.query.mockResolvedValue(completed);
    client.save.mutate.mockResolvedValueOnce('cancelled').mockResolvedValueOnce('failed');
    const user = userEvent.setup();
    renderPanel();
    const share = await screen.findByRole('button', { name: 'Share report' });
    await user.click(share);
    await user.click(await screen.findByRole('menuitem', { name: 'Save report to file…' }));
    expect(screen.queryByText('Could not save the diagnostics report.')).not.toBeInTheDocument();
    await user.click(share);
    await user.click(await screen.findByRole('menuitem', { name: 'Save report to file…' }));
    expect(await screen.findByText('Could not save the diagnostics report.')).toBeVisible();
    expect(screen.getByRole('region', { name: 'Could not verify Cosmos DB data-plane access.' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(share).toHaveFocus();
});
