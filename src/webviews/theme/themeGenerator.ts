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

/**
 * Fluent's neutral ramp (colorNeutralBackground2/3, strokes, …) is a *fixed*
 * gray produced by `createLightTheme`/`createDarkTheme`. It ignores the active
 * VS Code color theme, so surfaces painted with it (secondary panels/header
 * bands, the alternating rows of tables/lists, section separators) drift out of
 * tune on themes whose editor background is tinted or otherwise far from that gray.
 *
 * These overrides remap the neutral surfaces our webviews actually paint with
 * onto VS Code theme variables so they track the active theme. Each value falls
 * back through progressively more common surface tokens, because many community
 * themes leave the ideal one undefined. The VS Code variables are already
 * theme-appropriate, so the exact same expressions work for both the light and
 * dark adaptive themes.
 *
 * NOTE — neutral tokens still on the fixed Fluent ramp (candidates for a future
 * pass; see the "theme color coverage" tracking issue):
 *   - colorNeutralBackground3
 *   - colorNeutralBackground1Hover/Pressed/Selected
 *   - colorNeutralForeground3 / Foreground4 / ForegroundDisabled
 *   - colorNeutralStroke1 / Stroke3 / StrokeAccessible
 *   - colorSubtleBackground* (toolbar/button hover fills)
 *   - High-contrast theme kinds bypass this generator entirely and fall back to
 *     the static Teams themes (see getFluentUiTheme in state/ThemeContext.tsx),
 *     so none of the VS Code mappings apply there yet.
 */
const adaptiveNeutralSurfaces = {
    // Secondary neutral surface: header bands + odd alternating rows. Prefer VS
    // Code's own alternating table-row color, then the side bar / editor-widget
    // backgrounds.
    colorNeutralBackground2:
        'var(--vscode-tree-tableOddRowsBackground, var(--vscode-sideBar-background, var(--vscode-editorWidget-background)))',
    colorNeutralBackground2Hover:
        'var(--vscode-list-hoverBackground, var(--vscode-sideBar-background, var(--vscode-editorWidget-background)))',
    colorNeutralBackground2Pressed:
        'var(--vscode-list-activeSelectionBackground, var(--vscode-list-hoverBackground, var(--vscode-sideBar-background, var(--vscode-editorWidget-background))))',
    colorNeutralBackground2Selected:
        'var(--vscode-list-inactiveSelectionBackground, var(--vscode-list-hoverBackground, var(--vscode-sideBar-background, var(--vscode-editorWidget-background))))',
    // Subtle separators: header band borders, section rules.
    colorNeutralStroke2: 'var(--vscode-panel-border, var(--vscode-widget-border, var(--vscode-editorWidget-border)))',
} satisfies Partial<Theme>;

// Opaque skeleton/shimmer stencils. Fluent's defaults are fixed grays on the
// neutral ramp, so `opaque` skeletons render as a flat gray block that ignores
// the theme. We can't reuse solid VS Code tokens here: structural surfaces
// (editor-widget / side-bar background) can be far darker than the card, and
// hover/selection overlays can resolve to a saturated accent — both overshoot the
// gentle look we want. Instead we mimic what the `translucent` appearance does and
// paint faint *alpha overlays* that composite over whatever card sits behind the
// skeleton, so the block reads as a low-contrast tint of the surface (which
// already carries the theme hue). The direction follows the theme kind — darken on
// light, lighten on dark — matching Fluent's own translucent `*Alpha` scale.
// Stencil1 is the resting base; Stencil2 is the slightly stronger sweep band. Kept
// low on purpose: the opaque appearance layers a base fill under the animated
// sweep, so the two compose.
//
// (The translucent `*Alpha` variants are left at Fluent's defaults — that path
// already composites correctly and drives any `appearance="translucent"` skeleton.)
const lightSkeletonStencils = {
    colorNeutralStencil1: 'rgba(0, 0, 0, 0.07)',
    colorNeutralStencil2: 'rgba(0, 0, 0, 0.1)',
} satisfies Partial<Theme>;

const darkSkeletonStencils = {
    colorNeutralStencil1: 'rgba(255, 255, 255, 0.07)',
    colorNeutralStencil2: 'rgba(255, 255, 255, 0.1)',
} satisfies Partial<Theme>;

// https://react.fluentui.dev/?path=/docs/concepts-developer-theming--page#overriding-existing-tokens
export const generateAdaptiveLightTheme = (): Theme => {
    const style = getComputedStyle(document.documentElement);
    const buttonBackground = style.getPropertyValue('--vscode-button-background');
    const brandVSCode: BrandVariants = getBrandTokensFromPalette(buttonBackground);

    return {
        ...createLightTheme(brandVSCode),

        colorNeutralForeground1: 'var(--vscode-editor-foreground)',
        colorNeutralForeground1Hover: 'var(--vscode-editor-foreground)',
        colorNeutralForeground1Pressed: 'var(--vscode-editor-foreground)',
        colorNeutralForeground1Selected: 'var(--vscode-editor-foreground)',

        colorNeutralBackground1: 'var(--vscode-editor-background)',

        // Remap the secondary neutral surfaces onto VS Code theme variables
        // so header bands, alternating rows and separators track the active
        // theme instead of Fluent's fixed gray.
        ...adaptiveNeutralSurfaces,

        // Faint theme-direction alpha stencils so `opaque` skeletons read as a
        // gentle tint of the card instead of a flat gray block.
        ...lightSkeletonStencils,
    };
};

export const generateAdaptiveDarkTheme = (): Theme => {
    const style = getComputedStyle(document.documentElement);
    const buttonBackground = style.getPropertyValue('--vscode-button-background');
    const brandVSCode: BrandVariants = getBrandTokensFromPalette(buttonBackground);

    return {
        ...createDarkTheme(brandVSCode),

        colorNeutralForeground1: 'var(--vscode-editor-foreground)',
        colorNeutralForeground1Hover: 'var(--vscode-editor-foreground)',
        colorNeutralForeground1Pressed: 'var(--vscode-editor-foreground)',
        colorNeutralForeground1Selected: 'var(--vscode-editor-foreground)',
        colorNeutralForeground2: 'var(--vscode-foreground)',
        colorNeutralForeground2Hover: 'var(--vscode-foreground)',
        colorNeutralForeground2Pressed: 'var(--vscode-foreground)',
        colorNeutralForeground2Selected: 'var(--vscode-foreground)',

        colorNeutralBackground1: 'var(--vscode-editor-background)',

        // Remap the secondary neutral surfaces onto VS Code theme variables
        // so header bands, alternating rows and separators track the active
        // theme instead of Fluent's fixed gray.
        ...adaptiveNeutralSurfaces,

        // Faint theme-direction alpha stencils so `opaque` skeletons read as a
        // gentle tint of the card instead of a flat gray block.
        ...darkSkeletonStencils,
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
