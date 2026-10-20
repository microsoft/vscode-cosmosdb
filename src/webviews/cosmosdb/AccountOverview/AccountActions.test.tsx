/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { AriaLiveAnnouncer, FluentProvider, messageBarClassNames, webLightTheme } from '@fluentui/react-components';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ComponentProps, type PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountActions } from './AccountActions';

type ActionProps = ComponentProps<typeof AccountActions>;

const ariaNotify = vi.fn();
let originalAriaNotify: PropertyDescriptor | undefined;

beforeEach(() => {
    ariaNotify.mockReset();
    originalAriaNotify = Object.getOwnPropertyDescriptor(document, 'ariaNotify');
    Object.defineProperty(document, 'ariaNotify', { configurable: true, value: ariaNotify });
});

afterEach(() => {
    if (originalAriaNotify) {
        Object.defineProperty(document, 'ariaNotify', originalAriaNotify);
    } else {
        Reflect.deleteProperty(document, 'ariaNotify');
    }
});

function Wrapper({ children }: PropsWithChildren) {
    return (
        <FluentProvider theme={webLightTheme}>
            <AriaLiveAnnouncer>{children}</AriaLiveAnnouncer>
        </FluentProvider>
    );
}

function renderActions(overrides: Partial<ActionProps> = {}) {
    const props: ActionProps = {
        busy: false,
        supported: true,
        isAIFeaturesEnabled: true,
        onAction: vi.fn(),
        ...overrides,
    };
    return { props, ...render(<AccountActions {...props} />, { wrapper: Wrapper }) };
}

describe('AccountActions', () => {
    it('hides the entire Data Modeler promotion when AI features are disabled', () => {
        renderActions({ isAIFeaturesEnabled: false });
        expect(screen.queryByRole('button', { name: 'Try Data Modeler' })).not.toBeInTheDocument();
        expect(
            screen.queryByText('Design containers, partition keys, and relationships visually.'),
        ).not.toBeInTheDocument();
        for (const label of ['Add database', 'Add container', 'Delete account']) {
            expect(screen.getByRole('button', { name: label })).toBeEnabled();
        }
    });

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
        ['Try Data Modeler', { action: 'openDataModeler' }],
    ] as const)('dispatches %s by keyboard with the correct scope', async (label, input) => {
        const user = userEvent.setup();
        const { props } = renderActions({ databaseId: 'selected-db' });
        screen.getByRole('button', { name: label }).focus();
        await user.keyboard('{Enter}');
        expect(props.onAction).toHaveBeenCalledExactlyOnceWith(input);
    });

    it('opens Data Modeler when clicked', async () => {
        const user = userEvent.setup();
        const { props } = renderActions();
        const modeler = screen.getByRole('button', { name: 'Try Data Modeler' });
        expect(screen.getByText('Design containers, partition keys, and relationships visually.')).toBeVisible();
        expect(modeler).toBeEnabled();
        await user.click(modeler);
        expect(props.onAction).toHaveBeenCalledExactlyOnceWith({ action: 'openDataModeler' });
    });

    it.each([{ busy: true }, { supported: false }])('blocks Data Modeler for %j', async (overrides) => {
        const user = userEvent.setup();
        const { props } = renderActions(overrides);
        const modeler = screen.getByRole('button', { name: 'Try Data Modeler' });
        expect(modeler).toBeDisabled();
        await user.click(modeler);
        expect(props.onAction).not.toHaveBeenCalled();
    });

    it.each([
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

    it('allows Add container without a database scope and explains that a picker will follow', async () => {
        const user = userEvent.setup();
        const { props } = renderActions();
        const button = screen.getByRole('button', { name: 'Add container' });
        expect(button).toHaveTextContent('Add container');
        expect(button).toHaveAccessibleName('Add container');
        expect(button).not.toHaveAttribute('aria-disabled', 'true');
        button.focus();
        await waitFor(() =>
            expect(button).toHaveAccessibleDescription('Choose a database in this account, then create a container.'),
        );
        await user.keyboard('{Enter}');
        expect(props.onAction).toHaveBeenCalledExactlyOnceWith({ action: 'createContainer', databaseId: undefined });
    });

    it('updates the container tooltip and action payload when the selected database changes', async () => {
        const user = userEvent.setup();
        const { props, rerender } = renderActions({ databaseId: 'old-db' });
        rerender(<AccountActions {...props} databaseId="new-db" />);
        const button = screen.getByRole('button', { name: 'Add container' });
        await user.click(button);
        expect(props.onAction).toHaveBeenCalledExactlyOnceWith({ action: 'createContainer', databaseId: 'new-db' });
        await waitFor(() => expect(button).toHaveAccessibleDescription('Create a container in database new-db.'));
    });

    it('blocks all mutating actions without an inline progress message until busy clears', async () => {
        const user = userEvent.setup();
        const { props, rerender } = renderActions({ busy: true, databaseId: 'database' });
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
        expect(screen.queryByText('Account action in progress…')).not.toBeInTheDocument();
        for (const label of ['Add database', 'Delete account']) {
            const button = screen.getByRole('button', { name: label });
            expect(button).toBeDisabled();
            await user.click(button);
        }
        await user.click(screen.getByRole('button', { name: 'Add container' }));
        expect(props.onAction).not.toHaveBeenCalled();
        rerender(<AccountActions {...props} busy={false} />);
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
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
        const bar = screen.getByRole('group', { name: 'Error' });
        expect(bar).toHaveClass(messageBarClassNames.root);
        expect(bar).toBeVisible();
        expect(bar).toHaveTextContent(message);
        expect(ariaNotify).toHaveBeenCalledExactlyOnceWith(`Error ${message}`, { priority: 'high' });
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        rerender(<AccountActions {...props} failure={undefined} />);
        expect(screen.queryByRole('group', { name: 'Error' })).not.toBeInTheDocument();
    });

    it('announces newly shown or changed errors once without moving focus', () => {
        const { props, rerender } = renderActions();
        const trigger = screen.getByRole('button', { name: 'Add database' });
        trigger.focus();
        expect(ariaNotify).not.toHaveBeenCalled();
        rerender(<AccountActions {...props} failure="action" />);
        expect(ariaNotify).toHaveBeenCalledExactlyOnceWith(
            'Error The account action could not be completed. Retry or use the Azure Resources view.',
            { priority: 'high' },
        );
        expect(trigger).toHaveFocus();
        rerender(<AccountActions {...props} failure="action" databaseId="selected-db" />);
        expect(ariaNotify).toHaveBeenCalledTimes(1);
        rerender(<AccountActions {...props} failure="refresh" />);
        expect(ariaNotify).toHaveBeenCalledTimes(2);
        expect(ariaNotify).toHaveBeenLastCalledWith('Error Account data could not be refreshed. Try Refresh again.', {
            priority: 'high',
        });
        rerender(<AccountActions {...props} />);
        rerender(<AccountActions {...props} failure="refresh" />);
        expect(ariaNotify).toHaveBeenCalledTimes(3);
        expect(trigger).toHaveFocus();
    });

    it('uses the assertive live-region fallback when ariaNotify is unavailable', async () => {
        Reflect.deleteProperty(document, 'ariaNotify');
        const { props, rerender } = renderActions();
        rerender(<AccountActions {...props} failure="action" />);
        await waitFor(() =>
            expect(document.querySelector<HTMLSpanElement>('[aria-live="assertive"] span')?.innerText).toContain(
                'Error The account action could not be completed. Retry or use the Azure Resources view.',
            ),
        );
        expect(ariaNotify).not.toHaveBeenCalled();
    });
});
