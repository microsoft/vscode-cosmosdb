/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PreviewBadge } from './PreviewBadge';

afterEach(() => {
    vi.restoreAllMocks();
});

describe('PreviewBadge', () => {
    it('reports the initial rendered width without measuring again on ordinary rerenders', () => {
        const bounds = vi
            .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
            .mockReturnValue(new DOMRect(0, 0, 280, 32));
        const onWidthChange = vi.fn();
        const { rerender } = render(
            <FluentProvider theme={webLightTheme}>
                <PreviewBadge onWidthChange={onWidthChange} />
            </FluentProvider>,
        );
        expect(onWidthChange).toHaveBeenCalledExactlyOnceWith(280);
        bounds.mockReturnValue(new DOMRect(0, 0, 320, 32));
        rerender(
            <FluentProvider theme={webLightTheme}>
                <PreviewBadge className="updated" onWidthChange={onWidthChange} />
            </FluentProvider>,
        );
        expect(onWidthChange).toHaveBeenCalledExactlyOnceWith(280);
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
