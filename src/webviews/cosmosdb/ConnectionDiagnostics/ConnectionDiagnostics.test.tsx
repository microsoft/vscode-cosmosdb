/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { AriaLiveAnnouncer, FluentProvider, webLightTheme } from '@fluentui/react-components';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, onTestFinished, vi } from 'vitest';
import { type DiagnosticsState } from '../../../connectionDiagnostics/model';
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
vi.mock('@microsoft/vscode-ext-webview/react', () => ({ useTrpcClient: () => client }));

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
    const access = within(list).getByText('Cosmos DB data-plane access').closest('[role="listitem"]');
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
    expect(within(list).getByText(/This is expected for public access/)).toBeVisible();
    expect(within(list).getByText(/DNS does not show which route the SDK used/)).toBeVisible();
});

it('groups role assignment and documentation under the access check and restores focus after assignment', async () => {
    client.state.query.mockResolvedValue({
        ...completed,
        kind: 'azure',
        canAddDataRole: true,
        checks: [{ step: 'access', status: 'info', finding: 'dataRbac', auth: 'entra' }],
    } satisfies DiagnosticsState);
    client.addDataRole.mutate.mockResolvedValueOnce('cancelled').mockResolvedValueOnce('assigned');
    const user = userEvent.setup();
    renderPanel();

    const summary = await screen.findByRole('region', { name: 'Cosmos DB data role required.' });
    expect(screen.getByText(/The identity lacks Cosmos DB data-plane permissions/)).toBeVisible();
    expect(within(summary).queryByText(/The identity lacks Cosmos DB data-plane permissions/)).not.toBeInTheDocument();
    const row = screen.getByText('Cosmos DB data-plane access').closest('[role="listitem"]');
    const add = screen.getByRole('button', { name: 'Add Data Contributor role' });
    const docs = screen.getByRole('button', { name: 'Learn about Cosmos DB data-plane roles' });
    expect(add).toHaveTextContent('Add Data Contributor role');
    expect(docs).toHaveTextContent('Learn about Cosmos DB data-plane roles');
    expect(row).toContainElement(add);
    expect(row).toContainElement(docs);
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
});

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
    expect(rerun.textContent).toBe('Re-run');
    await user.click(rerun);
    await screen.findByText('Checking the connection…');
    expect(client.rerun.mutate).toHaveBeenCalledOnce();

    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(cancel.textContent).toBe('Cancel');
    expect(cancel).toHaveFocus();
    const list = screen.getByRole('list', { name: 'Connection checks' });
    expect(within(list).getByText('Cosmos DB data-plane access').closest('[role="listitem"]')).toHaveAttribute(
        'aria-current',
        'step',
    );
    expect(screen.queryByRole('button', { name: 'Share report' })).not.toBeInTheDocument();
    await user.click(cancel);
    await screen.findByRole('region', { name: 'Connection diagnostics cancelled.' });
    expect(client.cancel.mutate).toHaveBeenCalledOnce();
    expect(rerun).toHaveFocus();
    expect(within(list).getAllByText('Not run')).toHaveLength(3);
});

it('opens the report in the editor through the host and offers copy and save', async () => {
    client.state.query.mockResolvedValue(completed);
    client.copy.mutate.mockResolvedValue('done');
    client.save.mutate.mockResolvedValue('done');
    client.showReport.mutate.mockResolvedValue('done');
    const user = userEvent.setup();
    renderPanel();

    const showReport = await screen.findByRole('button', { name: 'Show report' });
    expect(showReport).toHaveTextContent('Show report');
    showReport.focus();
    await user.keyboard('{Enter}');
    expect(client.showReport.mutate).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    const share = screen.getByRole('button', { name: 'Share report' });
    expect(share).toHaveTextContent('Share report');
    await user.click(share);
    const copy = await screen.findByRole('menuitem', { name: 'Copy report to clipboard' });
    expect(copy).toHaveTextContent('Copy report to clipboard');
    await user.click(copy);
    expect(client.copy.mutate).toHaveBeenCalledOnce();
    expect(await screen.findByText('Diagnostics report copied.')).toBeVisible();

    await user.click(share);
    const save = await screen.findByRole('menuitem', { name: 'Save report to file…' });
    expect(save).toHaveTextContent('Save report to file…');
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
    output.focus();
    await user.keyboard('{Enter}');
    expect(client.showOutput.mutate).toHaveBeenCalledOnce();
});

it('can refresh after a status request failure without starting another diagnosis', async () => {
    client.state.query.mockRejectedValueOnce(new Error('status unavailable')).mockResolvedValue(completed);
    const user = userEvent.setup();
    renderPanel();
    expect(await screen.findByText('Could not update connection diagnostics.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Refresh status' }));
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
