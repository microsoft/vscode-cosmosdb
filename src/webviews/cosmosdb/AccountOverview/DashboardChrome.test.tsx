/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { Button, cardClassNames, FluentProvider, webLightTheme } from '@fluentui/react-components';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardCard } from './DashboardChrome';

function Wrapper({ children }: PropsWithChildren) {
    return <FluentProvider theme={webLightTheme}>{children}</FluentProvider>;
}

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
});

afterEach(() => vi.restoreAllMocks());

describe('DashboardCard', () => {
    it('uses a large Fluent Card while preserving custom classes and visible overflow', () => {
        render(
            <DashboardCard className="custom-card">
                <h2>Section heading</h2>
            </DashboardCard>,
            { wrapper: Wrapper },
        );
        const card = screen.getByRole('group');
        expect(card).toHaveClass(cardClassNames.root, 'custom-card');
        expect(card).toContainElement(screen.getByRole('heading', { name: 'Section heading' }));
        expect(card).not.toHaveAttribute('tabindex');
        const styles = getComputedStyle(card);
        expect(styles.getPropertyValue('--fui-Card--size')).toBe('16px');
        expect(styles.gap).toBe('var(--spacingVerticalM)');
        expect(styles.overflow).toBe('visible');
    });

    it('keeps child actions in the normal tab order without focusing or trapping within the card', async () => {
        const user = userEvent.setup();
        const onAction = vi.fn();
        render(
            <>
                <Button>Before</Button>
                <DashboardCard>
                    <Button onClick={onAction}>First action</Button>
                    <Button>Second action</Button>
                </DashboardCard>
                <Button>After</Button>
            </>,
            { wrapper: Wrapper },
        );
        await user.tab();
        expect(screen.getByRole('button', { name: 'Before' })).toHaveFocus();
        await user.tab();
        expect(screen.getByRole('button', { name: 'First action' })).toHaveFocus();
        await user.keyboard('{Enter}');
        expect(onAction).toHaveBeenCalledTimes(1);
        await user.tab();
        expect(screen.getByRole('button', { name: 'Second action' })).toHaveFocus();
        await user.tab();
        expect(screen.getByRole('button', { name: 'After' })).toHaveFocus();
        await user.tab({ shift: true });
        expect(screen.getByRole('button', { name: 'Second action' })).toHaveFocus();
    });
});
