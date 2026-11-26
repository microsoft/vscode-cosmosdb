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
    vi.spyOn(document.body, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1024, 768));
    vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(function (this: HTMLElement) {
        if (this.hidden || getComputedStyle(this).display === 'none') {
            return null;
        }
        for (let element = this.parentElement; element; element = element.parentElement) {
            if (element.hidden || getComputedStyle(element).display === 'none') {
                return null;
            }
        }
        return this.parentElement;
    });
    const matches = Element.prototype.matches;
    vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, selector: string) {
        return selector === ':modal' ? false : matches.call(this, selector);
    });
    ariaNotify.mockReset();
    originalAriaNotify = Object.getOwnPropertyDescriptor(document, 'ariaNotify');
    Object.defineProperty(document, 'ariaNotify', { configurable: true, value: ariaNotify });
});

afterEach(() => {
    vi.restoreAllMocks();
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
        isDataModelerEnabled: true,
        isDataModelerPromoCollapsed: false,
        onAction: vi.fn(),
        onDataModelerPromoCollapsedChange: vi.fn(),
        ...overrides,
    };
    return { props, ...render(<AccountActions {...props} />, { wrapper: Wrapper }) };
}

const modelerDescription =
    "Get a guided experience to design your containers and relationships, choose partition keys based on your application's queries and workload, and deploy when you're ready.";

describe('AccountActions', () => {
    it.each([
        { isAIFeaturesEnabled: false },
        { isDataModelerEnabled: false },
        { isAIFeaturesEnabled: false, isDataModelerPromoCollapsed: true },
        { isDataModelerEnabled: false, isDataModelerPromoCollapsed: true },
    ])('hides every Data Modeler entry point for %j', (overrides) => {
        renderActions(overrides);
        expect(screen.queryByRole('button', { name: 'Start guided data modeling' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Data Modeler' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Expand Data Modeler suggestion' })).not.toBeInTheDocument();
        expect(screen.queryByText('Need help designing your data model?')).not.toBeInTheDocument();
        for (const label of ['Add database', 'Add container', 'View Cost', 'View JSON', 'Delete account']) {
            expect(screen.getByRole('button', { name: label })).toBeEnabled();
        }
    });

    it.each([false, true])('names every action with its rendered visible label (collapsed: %s)', (collapsed) => {
        renderActions({ isDataModelerPromoCollapsed: collapsed });
        const actions = within(screen.getByRole('region', { name: 'Account actions' }));
        for (const label of [
            'Add database',
            'Add container',
            'View Cost',
            'View JSON',
            'Delete account',
            collapsed ? 'Data Modeler' : 'Start guided data modeling',
        ]) {
            const button = actions.getByRole('button', { name: label });
            expect(button).toHaveTextContent(label);
            expect(button).toHaveAccessibleName(label);
        }
        expect(actions.queryByRole('img')).not.toBeInTheDocument();
    });

    it.each([
        ['Add database', { action: 'createDatabase' }, false],
        ['Add container', { action: 'createContainer', databaseId: 'selected-db' }, false],
        ['View Cost', { action: 'openCosts' }, false],
        ['View JSON', { action: 'openJson' }, false],
        ['Delete account', { action: 'deleteAccount' }, false],
        ['Start guided data modeling', { action: 'openDataModeler' }, false],
        ['Data Modeler', { action: 'openDataModeler' }, true],
    ] as const)('dispatches %s by keyboard with the correct scope', async (label, input, collapsed) => {
        const user = userEvent.setup();
        const { props } = renderActions({ databaseId: 'selected-db', isDataModelerPromoCollapsed: collapsed });
        screen.getByRole('button', { name: label }).focus();
        await user.keyboard('{Enter}');
        expect(props.onAction).toHaveBeenCalledExactlyOnceWith(input);
    });

    it('promotes the guided Data Modeler experience in a labelled callout and opens it when clicked', async () => {
        const user = userEvent.setup();
        const { props } = renderActions();
        const callout = within(screen.getByRole('region', { name: 'Need help designing your data model?' }));
        expect(callout.getByRole('heading', { name: 'Need help designing your data model?' })).toBeVisible();
        expect(callout.getByText('Data Modeler')).toBeVisible();
        expect(callout.getByText(modelerDescription)).toBeVisible();
        const modeler = callout.getByRole('button', { name: 'Start guided data modeling' });
        expect(modeler).toHaveAccessibleDescription(modelerDescription);
        expect(modeler).toBeEnabled();
        await user.click(modeler);
        expect(props.onAction).toHaveBeenCalledExactlyOnceWith({ action: 'openDataModeler' });
        expect(props.onDataModelerPromoCollapsedChange).not.toHaveBeenCalled();
    });

    it('collapses the callout by keyboard and moves focus to the expand control', async () => {
        const user = userEvent.setup();
        const { props, rerender } = renderActions();
        const collapse = screen.getByRole('button', { name: 'Collapse Data Modeler suggestion' });
        expect(collapse).toHaveAttribute('aria-expanded', 'true');
        screen.getByRole('button', { name: 'Start guided data modeling' }).focus();
        await user.tab();
        expect(collapse).toHaveFocus();
        await waitFor(() =>
            expect(collapse).toHaveAccessibleDescription('Data Modeler stays available in the account actions.'),
        );
        await user.keyboard('{Enter}');
        expect(props.onDataModelerPromoCollapsedChange).toHaveBeenCalledExactlyOnceWith(true);
        expect(props.onAction).not.toHaveBeenCalled();

        rerender(<AccountActions {...props} isDataModelerPromoCollapsed />);
        expect(screen.queryByRole('region', { name: 'Need help designing your data model?' })).not.toBeInTheDocument();
        const expand = screen.getByRole('button', { name: 'Expand Data Modeler suggestion' });
        expect(expand).toHaveFocus();
        expect(expand).toHaveAttribute('aria-expanded', 'false');
        const compact = screen.getByRole('button', { name: 'Data Modeler' });
        await user.tab({ shift: true });
        expect(compact).toHaveFocus();
        await waitFor(() => expect(compact).toHaveAccessibleDescription(modelerDescription));
        await user.keyboard('{Enter}');
        expect(props.onAction).toHaveBeenCalledExactlyOnceWith({ action: 'openDataModeler' });
    });

    it('expands a collapsed callout from a subtle control and returns focus to its collapse control', async () => {
        const user = userEvent.setup();
        const { props, rerender } = renderActions({ isDataModelerPromoCollapsed: true });
        const compact = screen.getByRole('button', { name: 'Data Modeler' });
        const expand = screen.getByRole('button', { name: 'Expand Data Modeler suggestion' });
        expect(expand).toHaveTextContent('');
        compact.focus();
        await user.tab();
        expect(expand).toHaveFocus();
        await user.keyboard('{Enter}');
        expect(props.onDataModelerPromoCollapsedChange).toHaveBeenCalledExactlyOnceWith(false);
        expect(props.onAction).not.toHaveBeenCalled();

        rerender(<AccountActions {...props} isDataModelerPromoCollapsed={false} />);
        expect(screen.queryByRole('button', { name: 'Expand Data Modeler suggestion' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Data Modeler' })).not.toBeInTheDocument();
        expect(screen.getByRole('region', { name: 'Need help designing your data model?' })).toBeVisible();
        expect(screen.getByRole('button', { name: 'Collapse Data Modeler suggestion' })).toHaveFocus();
    });

    it('keeps the expand control available while Data Modeler launch is blocked', async () => {
        const user = userEvent.setup();
        const { props } = renderActions({ isDataModelerPromoCollapsed: true, busy: true });
        await user.click(screen.getByRole('button', { name: 'Expand Data Modeler suggestion' }));
        expect(props.onDataModelerPromoCollapsedChange).toHaveBeenCalledExactlyOnceWith(false);
    });

    it('does not steal focus when the callout is already collapsed on load', () => {
        renderActions({ isDataModelerPromoCollapsed: true });
        expect(screen.getByRole('button', { name: 'Data Modeler' })).not.toHaveFocus();
        expect(screen.getByRole('button', { name: 'Expand Data Modeler suggestion' })).not.toHaveFocus();
    });

    it.each([{ busy: true }, { supported: false }])('blocks Data Modeler for %j', async (overrides) => {
        const user = userEvent.setup();
        const { props, rerender } = renderActions(overrides);
        const modeler = screen.getByRole('button', { name: 'Start guided data modeling' });
        expect(modeler).toBeDisabled();
        await user.click(modeler);
        // Collapsing is a layout preference, so it stays available while actions are blocked.
        expect(screen.getByRole('button', { name: 'Collapse Data Modeler suggestion' })).toBeEnabled();
        rerender(<AccountActions {...props} isDataModelerPromoCollapsed />);
        const compact = screen.getByRole('button', { name: 'Data Modeler' });
        expect(compact).toHaveAttribute('aria-disabled', 'true');
        await user.click(compact);
        compact.focus();
        await user.keyboard('{Enter} ');
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
            const { props } = renderActions({ ...overrides, isDataModelerPromoCollapsed: true });
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

    it('blocks all account actions without an inline progress message until busy clears', async () => {
        const user = userEvent.setup();
        const { props, rerender } = renderActions({ busy: true, databaseId: 'database' });
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
        expect(screen.queryByText('Account action in progress…')).not.toBeInTheDocument();
        for (const label of ['Add database', 'View Cost', 'View JSON', 'Delete account']) {
            const button = screen.getByRole('button', { name: label });
            expect(button).toBeDisabled();
            await user.click(button);
        }
        await user.click(screen.getByRole('button', { name: 'Add container' }));
        expect(props.onAction).not.toHaveBeenCalled();
        rerender(<AccountActions {...props} busy={false} />);
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
        for (const label of ['Add database', 'View Cost', 'View JSON', 'Delete account']) {
            expect(screen.getByRole('button', { name: label })).toBeEnabled();
        }
        expect(screen.getByRole('button', { name: 'Add container' })).not.toHaveAttribute('aria-disabled', 'true');
    });

    it.each([
        ['Delete account', 'deleteAccount'],
        ['View Cost', 'openCosts'],
        ['View JSON', 'openJson'],
    ] as const)('disables creation for unsupported accounts but still allows %s', async (label, action) => {
        const user = userEvent.setup();
        const { props } = renderActions({ supported: false });
        expect(screen.getByRole('button', { name: 'Add database' })).toBeDisabled();
        await user.click(screen.getByRole('button', { name: 'Add database' }));
        expect(props.onAction).not.toHaveBeenCalled();
        await user.click(screen.getByRole('button', { name: label }));
        expect(props.onAction).toHaveBeenCalledExactlyOnceWith({ action });
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
