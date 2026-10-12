/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ComponentProps, type PropsWithChildren } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AccountActions } from './AccountActions';

type ActionProps = ComponentProps<typeof AccountActions>;

function Wrapper({ children }: PropsWithChildren) {
    return <FluentProvider theme={webLightTheme}>{children}</FluentProvider>;
}

function renderActions(overrides: Partial<ActionProps> = {}) {
    const props: ActionProps = { busy: false, supported: true, onAction: vi.fn(), ...overrides };
    return { props, ...render(<AccountActions {...props} />, { wrapper: Wrapper }) };
}

describe('AccountActions', () => {
    it('names every action with its rendered visible label', () => {
        renderActions();
        const actions = within(screen.getByRole('region', { name: 'Account actions' }));
        for (const label of ['Add database', 'Add container', 'Delete account', 'Try Data Modeler']) {
            const button = actions.getByRole('button', { name: label });
            expect(button).toHaveTextContent(label);
            expect(button).toHaveAccessibleName(label);
        }
        expect(actions.queryByRole('img')).not.toBeInTheDocument();
    });

    it.each([
        ['Add database', { action: 'createDatabase' }],
        ['Add container', { action: 'createContainer', databaseId: 'selected-db' }],
        ['Delete account', { action: 'deleteAccount' }],
    ] as const)('dispatches %s by keyboard with the correct scope', async (label, input) => {
        const user = userEvent.setup();
        const { props } = renderActions({ databaseId: 'selected-db' });
        screen.getByRole('button', { name: label }).focus();
        await user.keyboard('{Enter}');
        expect(props.onAction).toHaveBeenCalledExactlyOnceWith(input);
    });

    it('keeps Data Modeler focusable with an explanation, but never dispatches an action', async () => {
        const user = userEvent.setup();
        const { props } = renderActions();
        const modeler = screen.getByRole('button', { name: 'Try Data Modeler' });
        expect(screen.getByText('Design containers, partition keys, and relationships visually.')).toBeVisible();
        expect(modeler).toHaveAttribute('aria-disabled', 'true');
        expect(modeler).not.toBeDisabled();
        screen.getByRole('button', { name: 'Delete account' }).focus();
        await user.tab();
        expect(modeler).toHaveFocus();
        await waitFor(() => expect(modeler).toHaveAccessibleDescription('Data Modeler is not implemented yet.'));
        expect(await screen.findByRole('tooltip')).toHaveTextContent('Data Modeler is not implemented yet.');
        await user.keyboard('{Enter} ');
        await user.click(modeler);
        expect(props.onAction).not.toHaveBeenCalled();
    });

    it.each([
        ['without a selected database', {}, 'Select a database in the header to add a container.'],
        [
            'for an unsupported account',
            { supported: false, databaseId: 'selected-db' },
            'Create a container in database selected-db.',
        ],
        [
            'during an account action',
            { busy: true, databaseId: 'selected-db' },
            'Create a container in database selected-db.',
        ],
    ] satisfies [string, Partial<ActionProps>, string][])(
        'keeps Add container focusable but non-dispatching %s',
        async (_scenario, overrides: Partial<ActionProps>, description) => {
            const user = userEvent.setup();
            const { props } = renderActions(overrides);
            const button = screen.getByRole('button', { name: 'Add container' });
            expect(button).toHaveAttribute('aria-disabled', 'true');
            expect(button).not.toBeDisabled();
            // Add database is the first tab stop when enabled; otherwise Add container is first.
            await user.tab();
            if (!overrides.busy && overrides.supported !== false) {
                await user.tab();
            }
            expect(button).toHaveFocus();
            await waitFor(() => expect(button).toHaveAccessibleDescription(description));
            expect(await screen.findByRole('tooltip')).toHaveTextContent(description);
            await user.keyboard('{Enter} ');
            await user.click(button);
            expect(props.onAction).not.toHaveBeenCalled();
        },
    );

    it('updates the container tooltip and action payload when the selected database changes', async () => {
        const user = userEvent.setup();
        const { props, rerender } = renderActions({ databaseId: 'old-db' });
        rerender(<AccountActions {...props} databaseId="new-db" />);
        const button = screen.getByRole('button', { name: 'Add container' });
        await user.click(button);
        expect(props.onAction).toHaveBeenCalledExactlyOnceWith({ action: 'createContainer', databaseId: 'new-db' });
        await waitFor(() => expect(button).toHaveAccessibleDescription('Create a container in database new-db.'));
    });

    it('announces busy state and blocks all mutating actions until it clears', async () => {
        const user = userEvent.setup();
        const { props, rerender } = renderActions({ busy: true, databaseId: 'database' });
        expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
        expect(screen.getByRole('status')).toHaveTextContent('Account action in progress…');
        for (const label of ['Add database', 'Delete account']) {
            const button = screen.getByRole('button', { name: label });
            expect(button).toBeDisabled();
            await user.click(button);
        }
        await user.click(screen.getByRole('button', { name: 'Add container' }));
        expect(props.onAction).not.toHaveBeenCalled();
        rerender(<AccountActions {...props} busy={false} />);
        expect(screen.getByRole('status')).toBeEmptyDOMElement();
        expect(screen.getByRole('button', { name: 'Add database' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Delete account' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Add container' })).not.toHaveAttribute('aria-disabled', 'true');
    });

    it('disables creation for unsupported accounts but still allows deletion', async () => {
        const user = userEvent.setup();
        const { props } = renderActions({ supported: false });
        expect(screen.getByRole('button', { name: 'Add database' })).toBeDisabled();
        await user.click(screen.getByRole('button', { name: 'Add database' }));
        expect(props.onAction).not.toHaveBeenCalled();
        await user.click(screen.getByRole('button', { name: 'Delete account' }));
        expect(props.onAction).toHaveBeenCalledExactlyOnceWith({ action: 'deleteAccount' });
    });

    it.each([
        ['action', 'The account action could not be completed. Retry or use the Azure Resources view.'],
        ['refresh', 'Account data could not be refreshed. Try Refresh again.'],
    ] as const)('renders an explicit accessible %s failure', (failure, message) => {
        const { props, rerender } = renderActions({ failure });
        expect(screen.getByRole('alert')).toBeVisible();
        expect(screen.getByRole('alert')).toHaveTextContent(message);
        rerender(<AccountActions {...props} failure={undefined} />);
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
});
