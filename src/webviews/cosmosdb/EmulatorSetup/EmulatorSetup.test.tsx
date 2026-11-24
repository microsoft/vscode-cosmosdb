/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { AriaLiveAnnouncer } from '@fluentui/react-components';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmulatorSetup } from './EmulatorSetup';

const rpc = vi.hoisted(() => ({
    status: { query: vi.fn() },
    engines: { query: vi.fn() },
    checkProgress: { subscribe: vi.fn() },
    waitLonger: { mutate: vi.fn() },
}));

vi.mock('@microsoft/vscode-ext-webview/react', () => ({ useTrpcClient: () => rpc }));

beforeEach(() => {
    vi.clearAllMocks();
    rpc.status.query.mockResolvedValue({});
    rpc.checkProgress.subscribe.mockReturnValue({ unsubscribe: vi.fn() });
});

describe('EmulatorSetup', () => {
    it('shows both official install links when neither engine is present and detects Podman on retry', async () => {
        const user = userEvent.setup();
        rpc.engines.query.mockResolvedValueOnce({ engines: [] }).mockResolvedValueOnce({ engines: ['podman'] });
        render(
            <AriaLiveAnnouncer>
                <EmulatorSetup />
            </AriaLiveAnnouncer>,
        );
        await user.click(screen.getByRole('button', { name: 'Continue' }));
        expect(await screen.findByRole('heading', { name: 'Configure' })).toHaveFocus();
        expect(await screen.findByRole('link', { name: 'Install Docker' })).toHaveTextContent('Install Docker');
        expect(screen.getByRole('link', { name: 'Install Podman' })).toHaveAccessibleName('Install Podman');
        expect(screen.getByRole('spinbutton', { name: 'Cosmos DB endpoint port' })).toHaveValue(8081);
        expect(screen.getByRole('button', { name: 'Start setup' })).toBeDisabled();
        await user.click(screen.getByRole('button', { name: 'Check again' }));
        await waitFor(() => expect(screen.getByRole('radio', { name: 'Podman' })).toBeChecked());
        expect(screen.getByRole('button', { name: 'Start setup' })).toBeEnabled();
    });

    it('restores Wait longer with completed stages and keeps the checklist on Done', async () => {
        const user = userEvent.setup();
        rpc.status.query.mockResolvedValue({ instance: { status: 'waiting' } });
        rpc.waitLonger.mutate.mockResolvedValue({});
        render(
            <AriaLiveAnnouncer>
                <EmulatorSetup />
            </AriaLiveAnnouncer>,
        );
        const resume = await screen.findByRole('button', { name: 'Wait longer' });
        expect(resume).toHaveTextContent('Wait longer');
        expect(resume).toHaveAccessibleName('Wait longer');
        expect(screen.getByText('Prepare persistent data volume').parentElement).toHaveTextContent('Complete');
        await user.click(resume);
        expect(await screen.findByRole('heading', { name: 'Done' })).toHaveFocus();
        expect(rpc.waitLonger.mutate).toHaveBeenCalledOnce();
        expect(screen.getByText('Save the emulator connection').parentElement).toHaveTextContent('Complete');
    });
});
