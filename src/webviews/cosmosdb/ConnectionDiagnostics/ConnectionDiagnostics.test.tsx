/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { AriaLiveAnnouncer, FluentProvider, webLightTheme } from '@fluentui/react-components';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { type DiagnosticsState } from '../../../connectionDiagnostics/model';
import { ConnectionDiagnostics } from './ConnectionDiagnostics';

const client = vi.hoisted(() => ({
    state: { query: vi.fn() },
    rerun: { mutate: vi.fn() },
    cancel: { mutate: vi.fn() },
    copy: { mutate: vi.fn() },
    save: { mutate: vi.fn() },
}));
vi.mock('@microsoft/vscode-ext-webview/react', () => ({ useTrpcClient: () => client }));

beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.restoreAllMocks());

const completed: DiagnosticsState = {
    kind: 'attached',
    phase: 'completed',
    checks: [
        { step: 'target', status: 'passed', finding: 'endpointReady' },
        { step: 'access', status: 'failed', finding: 'firewallPublic', observedClientIp: '203.0.113.45' },
    ],
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

it('shows the outcome and makes check details available from the keyboard', async () => {
    client.state.query.mockResolvedValue(completed);
    const user = userEvent.setup();
    renderPanel();
    const summary = await screen.findByRole('region', { name: 'Could not verify access to Cosmos DB.' });
    expect(within(summary).getByText(/Check public network access and the IP allowlist/)).toBeVisible();
    const list = screen.getByRole('list', { name: 'Connection checks' });
    const details = within(list).getByRole('button', { name: 'Details — Cosmos DB access' });
    const localIp = within(list).getByText('Outgoing IP reported by Cosmos DB: 203.0.113.45');
    expect(details).toHaveTextContent('Details');
    expect(details).toHaveAccessibleName('Details — Cosmos DB access');
    expect(localIp).not.toBeVisible();
    details.focus();
    await user.keyboard('{Enter}');
    expect(details).toHaveAttribute('aria-expanded', 'true');
    expect(localIp).toBeVisible();
    await user.keyboard(' ');
    expect(details).toHaveAttribute('aria-expanded', 'false');
    expect(localIp).not.toBeVisible();
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
    await screen.findByRole('region', { name: 'Could not verify access to Cosmos DB.' });
    const rerun = screen.getByRole('button', { name: 'Run again' });
    expect(rerun.textContent).toBe('Run again');
    await user.click(rerun);
    await screen.findByText('Checking: Cosmos DB access', { selector: 'p' });
    expect(client.rerun.mutate).toHaveBeenCalledOnce();

    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(cancel.textContent).toBe('Cancel');
    expect(cancel).toHaveFocus();
    expect(screen.getByRole('progressbar', { name: 'Connection check progress' })).toHaveAttribute(
        'aria-valuenow',
        '1',
    );
    const list = screen.getByRole('list', { name: 'Connection checks' });
    expect(within(list).getByText('Cosmos DB access').closest('li')).toHaveAttribute('aria-current', 'step');
    expect(screen.queryByRole('button', { name: 'Share report' })).not.toBeInTheDocument();
    await user.click(cancel);
    await screen.findByRole('region', { name: 'Connection diagnostics cancelled.' });
    expect(client.cancel.mutate).toHaveBeenCalledOnce();
    expect(rerun).toHaveFocus();
    expect(within(list).getAllByText('Not run')).toHaveLength(4);
});

it('previews the redacted report and restores focus, then offers copy and save', async () => {
    // Provide the geometry Tabster uses for focus management, which jsdom does not calculate.
    vi.spyOn(document.body, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ width: 900, height: 600 }));
    vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockReturnValue(document.body);
    client.state.query.mockResolvedValue(completed);
    client.copy.mutate.mockResolvedValue('done');
    client.save.mutate.mockResolvedValue('done');
    const user = userEvent.setup();
    renderPanel();

    const showReport = await screen.findByRole('button', { name: 'Show report' });
    expect(showReport).toHaveTextContent('Show report');
    await user.click(showReport);
    const dialog = await screen.findByRole('dialog', { name: 'Redacted diagnostics report' });
    const report = within(dialog).getByRole<HTMLTextAreaElement>('textbox', { name: 'Report contents' });
    await waitFor(() => expect(report).toHaveFocus());
    expect(report.value).toContain('IP allowlist');
    expect(report.value).not.toContain('203.0.113.45');
    expect(report).toHaveAttribute('readonly');
    expect(within(dialog).getByRole('button', { name: 'Close' })).toHaveTextContent('Close');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(showReport).toHaveFocus());

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

it('can refresh after a status request failure without starting another diagnosis', async () => {
    client.state.query.mockRejectedValueOnce(new Error('status unavailable')).mockResolvedValue(completed);
    const user = userEvent.setup();
    renderPanel();
    expect(await screen.findByText('Could not update connection diagnostics.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Refresh status' }));
    expect(await screen.findByRole('region', { name: 'Could not verify access to Cosmos DB.' })).toBeVisible();
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
    expect(screen.getByRole('region', { name: 'Could not verify access to Cosmos DB.' })).toBeVisible();
});
