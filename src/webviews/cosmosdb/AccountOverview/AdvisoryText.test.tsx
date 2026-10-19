/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { FluentProvider, tokens, webDarkTheme, webLightTheme } from '@fluentui/react-components';
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
            expect(value).toHaveStyle({ fontWeight: tokens.fontWeightBold, overflowWrap: 'anywhere' });
            expect(value).not.toHaveAttribute('tabindex');
            expect(value).not.toHaveAttribute('aria-label');
            expect(value).not.toHaveAttribute('aria-hidden');
            expect(value).not.toHaveAttribute('role');
            expect(value).not.toHaveAttribute('aria-live');
        }
        expect(container.querySelector('p')).not.toHaveStyle({ fontWeight: tokens.fontWeightBold });
        expect(container.querySelector('p')?.querySelectorAll('span')).toHaveLength(3);
    });

    it('preserves escaped delimiters, empty and unmatched markup and long highlighted values', () => {
        const longValue = 'metric'.repeat(100);
        const { container } = render(
            <p>
                <AdvisoryText text={'Plain \\`literal\\` and ``; `' + longValue + '`; `unfinished'} />
            </p>,
        );
        expect(container.querySelector('p')?.textContent).toBe(
            'Plain `literal` and ``; ' + longValue + '; `unfinished',
        );
        expect(container.querySelectorAll('span')).toHaveLength(1);
        const value = screen.getByText(longValue);
        expect(value).toHaveStyle({
            fontWeight: tokens.fontWeightBold,
            overflowWrap: 'anywhere',
        });
        const rules = Array.from(document.styleSheets).flatMap((sheet) => Array.from(sheet.cssRules));
        const appliedStyles = rules
            .filter((rule): rule is CSSStyleRule => rule.type === CSSRule.STYLE_RULE)
            .filter((rule) => value.matches(rule.selectorText))
            .map((rule) => rule.style.cssText)
            .join('\n');
        expect(appliedStyles).toContain(`background-color: ${tokens.colorNeutralBackground3};`);
        expect(appliedStyles).toContain(`color: ${tokens.colorNeutralForeground1};`);
        expect(appliedStyles).toContain(`border-radius: ${tokens.borderRadiusSmall};`);
        expect(appliedStyles).toContain(`padding: 0 ${tokens.spacingHorizontalXXS};`);
        const css = rules.map((rule) => rule.cssText).join('\n');
        expect(css).toMatch(/@media \(forced-colors: active\)[\s\S]*outline: 1px solid CanvasText/);
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
