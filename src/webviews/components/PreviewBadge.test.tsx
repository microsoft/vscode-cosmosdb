/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PreviewBadge } from './PreviewBadge';

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('PreviewBadge', () => {
    it('reports the rendered width initially and as the badge grows, and disconnects on unmount', () => {
        const callbacks = new Map<Element, () => void>();
        const disconnect = vi.fn();
        vi.stubGlobal(
            'ResizeObserver',
            class {
                private callback: ResizeObserverCallback;
                constructor(callback: ResizeObserverCallback) {
                    this.callback = callback;
                }
                observe(target: Element) {
                    callbacks.set(target, () => this.callback([], this));
                }
                unobserve(target: Element) {
                    callbacks.delete(target);
                }
                disconnect = disconnect;
            },
        );
        const bounds = vi
            .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
            .mockReturnValue(new DOMRect(0, 0, 84, 32));
        const onWidthChange = vi.fn();
        const { unmount } = render(
            <FluentProvider theme={webLightTheme}>
                <PreviewBadge onWidthChange={onWidthChange} />
            </FluentProvider>,
        );
        expect(onWidthChange).toHaveBeenLastCalledWith(84);
        bounds.mockReturnValue(new DOMRect(0, 0, 280, 32));
        act(() => callbacks.get(screen.getByLabelText('Preview'))?.());
        expect(onWidthChange).toHaveBeenLastCalledWith(280);
        unmount();
        expect(disconnect).toHaveBeenCalled();
    });

    it('uses the floating migration chip styling and exposes its tooltip on keyboard focus', async () => {
        const user = userEvent.setup();
        render(
            <FluentProvider theme={webLightTheme}>
                <PreviewBadge />
            </FluentProvider>,
        );

        const badge = screen.getByLabelText('Preview');
        expect(badge).toHaveTextContent('Preview');
        expect(badge).toHaveAccessibleName('Preview');
        expect(badge).toHaveStyle({
            height: '32px',
            paddingLeft: '20px',
            paddingRight: '20px',
            borderRadius: '6px',
            marginTop: '8px',
            marginRight: '8px',
        });

        await user.tab();

        expect(badge).toHaveFocus();
        expect(await screen.findByRole('tooltip')).toHaveTextContent(
            'Preview: features and behavior may change. Use with care.',
        );
        expect(badge).toHaveAccessibleDescription('Preview: features and behavior may change. Use with care.');
    });
});
