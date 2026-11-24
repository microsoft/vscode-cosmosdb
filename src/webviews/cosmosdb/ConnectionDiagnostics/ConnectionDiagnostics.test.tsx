/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { AriaLiveAnnouncer } from '@fluentui/react-components';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { type DiagnosticsState } from '../../../connectionDiagnostics/model';
import { ConnectionDiagnostics } from './ConnectionDiagnostics';

const client = vi.hoisted(() => ({
    state: { query: vi.fn() },
    rerun: { mutate: vi.fn() },
    cancel: { mutate: vi.fn() },
    copy: { mutate: vi.fn() },
}));
vi.mock('@microsoft/vscode-ext-webview/react', () => ({ useTrpcClient: () => client }));

beforeEach(() => vi.resetAllMocks());

it('uses visible labels as accessible names and supports copying, rerunning, and cancelling', async () => {
    const completed: DiagnosticsState = {
        kind: 'attached',
        phase: 'completed',
        checks: [{ step: 'access', status: 'failed', finding: 'firewallPublic', observedClientIp: '203.0.113.45' }],
    };
    const running: DiagnosticsState = { kind: 'attached', phase: 'running', active: 'access', checks: [] };
    const cancelled: DiagnosticsState = { kind: 'attached', phase: 'cancelled', checks: [] };
    client.state.query.mockResolvedValueOnce(completed).mockResolvedValue(running);
    client.rerun.mutate.mockResolvedValue(running);
    client.cancel.mutate.mockImplementation(() => {
        client.state.query.mockResolvedValue(cancelled);
    });
    const user = userEvent.setup();
    render(
        <AriaLiveAnnouncer>
            <ConnectionDiagnostics />
        </AriaLiveAnnouncer>,
    );
    await screen.findByText('Outgoing IP reported by Cosmos DB: 203.0.113.45');

    const copy = screen.getByRole('button', { name: 'Copy redacted report' });
    expect(copy.textContent).toBe('Copy redacted report');
    await user.click(copy);
    expect(client.copy.mutate).toHaveBeenCalledOnce();

    const rerun = screen.getByRole('button', { name: 'Run again' });
    expect(rerun.textContent).toBe('Run again');
    await user.click(rerun);
    await screen.findByText('Checking: Cosmos DB access', { selector: 'p' });
    expect(client.rerun.mutate).toHaveBeenCalledOnce();

    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(cancel.textContent).toBe('Cancel');
    await user.click(cancel);
    await screen.findByText('Connection diagnostics cancelled.', { selector: 'p' });
    expect(client.cancel.mutate).toHaveBeenCalledOnce();
});
