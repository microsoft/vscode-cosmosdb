/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { PreviewBadge } from './PreviewBadge';

describe('PreviewBadge', () => {
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
