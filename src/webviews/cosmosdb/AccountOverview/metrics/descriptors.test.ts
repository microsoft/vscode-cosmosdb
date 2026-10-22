/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    teamsHighContrastTheme,
    teamsLightTheme,
    type Theme,
    webDarkTheme,
    webLightTheme,
} from '@fluentui/react-components';
import { describe, expect, it } from 'vitest';
import { METRIC_GROUPS } from './descriptors';

function resolveColor(theme: Theme, token: string): string {
    const value = Object.entries(theme).find(([name]) => token === `var(--${name})`)?.[1];
    if (typeof value !== 'string' || !/^#[\da-f]{6}$/i.test(value)) {
        throw new Error(`Expected an opaque sRGB color for ${token}, received ${value}`);
    }
    return value;
}

function luminance(hex: string): number {
    const channels = [1, 3, 5].map((offset) => {
        const channel = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(foreground: string, background: string): number {
    const first = luminance(foreground);
    const second = luminance(background);
    return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

describe.each([
    ['light', webLightTheme],
    ['dark', webDarkTheme],
    ['high contrast', teamsHighContrastTheme],
    ['high contrast light fallback', teamsLightTheme],
] as const)('metric palette contrast in %s', (_, theme) => {
    it.each(Object.entries(METRIC_GROUPS))('%s meets text and indicator contrast targets', (_, group) => {
        const foreground = resolveColor(theme, group.color);
        const background = resolveColor(theme, group.background);
        const border = resolveColor(theme, group.border);

        expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(border, background)).toBeGreaterThan(3);
        expect(contrast(border, theme.colorNeutralBackground1)).toBeGreaterThan(3);
        expect(contrast(foreground, theme.colorNeutralBackground1)).toBeGreaterThan(3);
    });

    it('keeps unselected text and outlines readable at rest and on hover', () => {
        expect(contrast(theme.colorNeutralForeground2, theme.colorNeutralBackground1)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(theme.colorNeutralStrokeAccessible, theme.colorNeutralBackground1)).toBeGreaterThan(3);
        expect(contrast(theme.colorNeutralForeground1Hover, theme.colorNeutralBackground1Hover)).toBeGreaterThanOrEqual(
            4.5,
        );
        // In high contrast, the hover fill and outline share a color that contrasts with the surrounding canvas.
        expect(
            Math.max(
                contrast(theme.colorNeutralStrokeAccessibleHover, theme.colorNeutralBackground1Hover),
                contrast(theme.colorNeutralStrokeAccessibleHover, theme.colorNeutralBackground1),
            ),
        ).toBeGreaterThan(3);
    });

    it('keeps the neutral inapplicable selection readable without a family color', () => {
        expect(contrast(theme.colorNeutralForeground2, theme.colorNeutralBackground2)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(theme.colorNeutralStrokeAccessible, theme.colorNeutralBackground2)).toBeGreaterThan(3);
    });
});
