/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import {
    Button,
    FluentProvider,
    Menu,
    MenuItem,
    MenuList,
    MenuPopover,
    MenuTrigger,
    tokens,
    webDarkTheme,
} from '@fluentui/react-components';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type PropsWithChildren } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThemedTooltip } from './ThemedTooltip';

const initialKind = document.body.getAttribute('data-vscode-theme-kind');

function Wrapper({ children }: PropsWithChildren) {
    return <FluentProvider theme={webDarkTheme}>{children}</FluentProvider>;
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    if (initialKind === null) {
        document.body.removeAttribute('data-vscode-theme-kind');
    } else {
        document.body.setAttribute('data-vscode-theme-kind', initialKind);
    }
});

describe('ThemedTooltip', () => {
    it.each([
        {
            kind: 'vscode-dark',
            background: tokens.colorNeutralBackgroundStatic,
            color: tokens.colorNeutralForegroundStaticInverted,
        },
        { kind: 'vscode-light', background: tokens.colorNeutralBackground1, color: tokens.colorNeutralForeground1 },
        {
            kind: 'vscode-high-contrast',
            background: tokens.colorNeutralBackground1,
            color: tokens.colorNeutralForeground1,
        },
        {
            kind: 'vscode-high-contrast-light',
            background: tokens.colorNeutralBackground1,
            color: tokens.colorNeutralForeground1,
        },
    ])('uses the standard Fluent foreground and surface in $kind', ({ kind, background, color }) => {
        document.body.setAttribute('data-vscode-theme-kind', kind);
        render(
            <ThemedTooltip content="Details" relationship="description" visible withArrow>
                <Button>Inspect</Button>
            </ThemedTooltip>,
            { wrapper: Wrapper },
        );
        const tooltip = screen.getByRole('tooltip');
        expect(getComputedStyle(tooltip).backgroundColor).toBe(background);
        expect(getComputedStyle(tooltip).color).toBe(color);
        const button = screen.getByRole('button', { name: 'Inspect' });
        expect(button).toHaveTextContent('Inspect');
        expect(button).toHaveAccessibleName('Inspect');
        expect(button).toHaveAccessibleDescription('Details');
    });

    it.each([
        {
            kind: 'vscode-dark',
            appearance: 'normal',
            background: tokens.colorNeutralBackground1,
            color: tokens.colorNeutralForeground1,
        },
        {
            kind: 'vscode-light',
            appearance: 'inverted',
            background: tokens.colorNeutralBackgroundStatic,
            color: tokens.colorNeutralForegroundStaticInverted,
        },
    ] as const)('preserves explicit $appearance appearance in $kind', ({ kind, appearance, background, color }) => {
        document.body.setAttribute('data-vscode-theme-kind', kind);
        render(
            <ThemedTooltip content="Details" relationship="description" appearance={appearance} visible>
                <Button>Inspect</Button>
            </ThemedTooltip>,
            { wrapper: Wrapper },
        );
        const tooltip = screen.getByRole('tooltip');
        expect(getComputedStyle(tooltip).backgroundColor).toBe(background);
        expect(getComputedStyle(tooltip).color).toBe(color);
    });

    it('updates an open tooltip when the theme changes without moving focus', async () => {
        document.body.setAttribute('data-vscode-theme-kind', 'vscode-light');
        render(
            <ThemedTooltip content="Details" relationship="description" visible>
                <Button>Inspect</Button>
            </ThemedTooltip>,
            { wrapper: Wrapper },
        );
        const button = screen.getByRole('button', { name: 'Inspect' });
        button.focus();
        await act(async () => document.body.setAttribute('data-vscode-theme-kind', 'vscode-dark'));
        await waitFor(() =>
            expect(getComputedStyle(screen.getByRole('tooltip')).backgroundColor).toBe(
                tokens.colorNeutralBackgroundStatic,
            ),
        );
        expect(getComputedStyle(screen.getByRole('tooltip')).color).toBe(tokens.colorNeutralForegroundStaticInverted);
        expect(button).toHaveFocus();
        await act(async () => document.body.setAttribute('data-vscode-theme-kind', 'vscode-high-contrast'));
        await waitFor(() =>
            expect(getComputedStyle(screen.getByRole('tooltip')).backgroundColor).toBe(tokens.colorNeutralBackground1),
        );
        expect(getComputedStyle(screen.getByRole('tooltip')).color).toBe(tokens.colorNeutralForeground1);
        expect(button).toHaveFocus();
    });

    it('preserves content-slot props, styles and accessible relationships', () => {
        document.body.setAttribute('data-vscode-theme-kind', 'vscode-dark');
        render(
            <ThemedTooltip
                content={{
                    children: <strong>Details</strong>,
                    id: 'custom-tooltip',
                    className: 'custom-content',
                    style: { maxWidth: 360 },
                }}
                relationship="description"
                visible
            >
                <Button>Inspect</Button>
            </ThemedTooltip>,
            { wrapper: Wrapper },
        );
        const tooltip = screen.getByRole('tooltip');
        expect(tooltip).toHaveAttribute('id', 'custom-tooltip');
        expect(tooltip).toHaveClass('custom-content');
        expect(tooltip).toHaveStyle({ maxWidth: '360px', backgroundColor: tokens.colorNeutralBackgroundStatic });
        expect(tooltip.querySelector('strong')).toHaveTextContent('Details');
        expect(screen.getByRole('button', { name: 'Inspect' })).toHaveAccessibleDescription('Details');
    });

    it('preserves nested menu-trigger keyboard behavior', async () => {
        document.body.setAttribute('data-vscode-theme-kind', 'vscode-dark');
        vi.spyOn(document.body, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1024, 768));
        vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(function (this: HTMLElement) {
            return this.parentElement;
        });
        const user = userEvent.setup();
        render(
            <Menu>
                <MenuTrigger>
                    <ThemedTooltip content="Available actions" relationship="description">
                        <Button>Actions</Button>
                    </ThemedTooltip>
                </MenuTrigger>
                <MenuPopover>
                    <MenuList>
                        <MenuItem>Inspect</MenuItem>
                    </MenuList>
                </MenuPopover>
            </Menu>,
            { wrapper: Wrapper },
        );
        const button = screen.getByRole('button', { name: 'Actions' });
        expect(button).toHaveTextContent('Actions');
        expect(button).toHaveAccessibleName('Actions');
        expect(button).toHaveAccessibleDescription('Available actions');
        button.focus();
        await user.keyboard('{Enter}');
        const item = await screen.findByRole('menuitem', { name: 'Inspect' });
        await waitFor(() => expect(item).toHaveFocus());
        await user.keyboard('{Escape}');
        await waitFor(() => expect(screen.queryByRole('menuitem')).not.toBeInTheDocument());
        expect(button).toHaveFocus();
    });
});
