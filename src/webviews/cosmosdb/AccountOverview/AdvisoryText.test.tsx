/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { FluentProvider, webDarkTheme, webLightTheme } from '@fluentui/react-components';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AdvisoryText } from './AdvisoryText';

describe('AdvisoryText', () => {
    it.each([webLightTheme, webDarkTheme])('keeps highlights in the normal sentence and reading order', (theme) => {
        const { container } = render(
            <FluentProvider theme={theme}>
                <p>
                    <AdvisoryText text={'Observed `5%` over `30 days`; target `~400 RU/s`.'} />
                </p>
            </FluentProvider>,
        );
        expect(container.querySelector('p')?.textContent).toBe('Observed 5% over 30 days; target ~400 RU/s.');
        for (const text of ['5%', '30 days', '~400 RU/s']) {
            const value = screen.getByText(text);
            expect(value.tagName).toBe('SPAN');
            expect(value).not.toHaveAttribute('tabindex');
            expect(value).not.toHaveAttribute('aria-label');
            expect(value).not.toHaveAttribute('aria-hidden');
            expect(value).not.toHaveAttribute('role');
            expect(value).not.toHaveAttribute('aria-live');
        }
    });

    it('renders HTML and other Markdown literally, including inside highlights', () => {
        const text = '**bold** [link](https://example.com) `<img src=x onerror=alert(1)>`';
        const { container } = render(
            <p>
                <AdvisoryText text={text} />
            </p>,
        );
        expect(container.querySelector('p')?.textContent).toBe(text.replaceAll('`', ''));
        expect(container.querySelector('img, a, strong, script')).toBeNull();
        expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    });
});
