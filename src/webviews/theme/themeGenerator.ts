/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type BrandVariants, createDarkTheme, createLightTheme, type Theme } from '@fluentui/react-components';
import { type MonacoBuiltinTheme, type MonacoColors, type MonacoThemeData } from './state/ThemeState';
import { hex_to_LCH, hexColorsFromPalette, type Palette, RGBAToHexA } from './utils';
import { vscodeThemeTokens, vscodeThemeTokenToCSSVar } from './vscodeThemeTokens';

type Options = {
    darkCp?: number;
    lightCp?: number;
    hueTorsion?: number;
};

/**
 * A palette is represented as a continuous curve through LAB space, made of two quadratic bezier curves that start at
 * 0L (black) and 100L (white) and meet at the LAB value of the provided key color.
 *
 * This function takes in a palette as input, which consists of:
 * keyColor:        The primary color in the LCH (Lightness Chroma Hue) color space
 * darkCp, lightCp: The control point of the quadratic beizer curve towards black and white, respectively (between 0-1).
 *                  Higher values move the control point toward the ends of the gamut causing chroma/saturation to
 *                  diminish more slowly near the key color, and lower values move the control point toward the key
 *                  color causing chroma/saturation to diminish more linearly.
 * hueTorsion:      Enables the palette to move through different hues by rotating the curve’s points in LAB space,
 *                  creating a helical curve

 * The function returns a set of brand tokens.
 */
export function getBrandTokensFromPalette(keyColor: string, options: Options = {}) {
    const { darkCp = 2 / 3, lightCp = 1 / 3, hueTorsion = 0 } = options;

    if (!keyColor.startsWith('#')) {
        if (keyColor.startsWith('rgb')) {
            keyColor = RGBAToHexA(keyColor);
        }

        // TODO: If the color is not a hex value
    }

    const brandPalette: Palette = {
        keyColor: hex_to_LCH(keyColor),
        darkCp,
        lightCp,
        hueTorsion,
    };
    const hexColors = hexColorsFromPalette(keyColor, brandPalette, 16, 1);
    return hexColors.reduce((acc: Record<string, string>, hexColor, h) => {
        acc[`${(h + 1) * 10}`] = hexColor;
        return acc;
    }, {}) as BrandVariants;
}

// https://react.fluentui.dev/?path=/docs/concepts-developer-theming--page#overriding-existing-tokens
export const generateAdaptiveLightTheme = (): Theme => {
    const style = getComputedStyle(document.documentElement);
    const buttonBackground = style.getPropertyValue('--vscode-button-background');
    const brandVSCode: BrandVariants = getBrandTokensFromPalette(buttonBackground);

    return {
        ...createLightTheme(brandVSCode),
        ...{
            colorNeutralForeground1: 'var(--vscode-editor-foreground)',
            colorNeutralForeground1Hover: 'var(--vscode-editor-foreground)',
            colorNeutralForeground1Pressed: 'var(--vscode-editor-foreground)',
            colorNeutralForeground1Selected: 'var(--vscode-editor-foreground)',

            colorNeutralBackground1: 'var(--vscode-editor-background)',
        },
    };
};

export const generateAdaptiveDarkTheme = (): Theme => {
    const style = getComputedStyle(document.documentElement);
    const buttonBackground = style.getPropertyValue('--vscode-button-background');
    const brandVSCode: BrandVariants = getBrandTokensFromPalette(buttonBackground);

    return {
        ...createDarkTheme(brandVSCode),
        ...{
            colorNeutralForeground1: 'var(--vscode-button-foreground)',
            colorNeutralForeground1Hover: 'var(--vscode-button-foreground)',
            colorNeutralForeground1Pressed: 'var(--vscode-button-foreground)',
            colorNeutralForeground1Selected: 'var(--vscode-button-foreground)',
            colorNeutralForeground2: 'var(--vscode-button-secondaryForeground)',
            colorNeutralForeground2Hover: 'var(--vscode-button-secondaryForeground)',
            colorNeutralForeground2Pressed: 'var(--vscode-button-secondaryForeground)',
            colorNeutralForeground2Selected: 'var(--vscode-button-secondaryForeground)',

            colorNeutralBackground1: 'var(--vscode-editor-background)',
        },
    };
};

export const generateMonacoTheme = (baseTheme: MonacoBuiltinTheme): MonacoThemeData => {
    const style = getComputedStyle(document.documentElement);
    const colors = vscodeThemeTokens
        .map((token) => {
            let color = style.getPropertyValue(vscodeThemeTokenToCSSVar(token));
            if (!color.startsWith('#')) {
                if (color.startsWith('rgb')) {
                    color = RGBAToHexA(color);
                }
            }
            return [token, color];
        })
        .filter(([_, color]) => color !== '');

    return {
        base: baseTheme,
        inherit: true,
        rules: [],
        colors: Object.fromEntries(colors) as MonacoColors,
    };
};
