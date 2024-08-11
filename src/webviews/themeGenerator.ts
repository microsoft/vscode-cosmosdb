import { createLightTheme, type BrandVariants, type Theme } from "@fluentui/react-components";

const vscodeVariants: BrandVariants = {
    /**
     * In general, it should go from the darkest to the brightest
     * the code used to create the theme will do some math and
     * come up with a full palette.
     * That's the quick and easy fix, but will very likely need
     * a lot of manual overrides, we'll learn about them over time
     *
     * TN attempted to use ThemeGenerator here for a better result,
     * but the time-cost to get there seemed to high in the end.
     *
     * So, the basic idea now is just leave gaps, and compute averages
     * between them to cover more...
     * but in order to get there, we'd have to extract the variables.
     * And this can only happen at runtime of the view, not an easy approach either.
     *
     * Look what the FluentUI team did here:
     * https://github.com/microsoft/fluentui/blob/master/packages/tokens/src/alias/lightColor.ts#L7
     * no computation either. well, at least we see which brand entries are being ignored anyway.
     * approx. 50% so no reason to ignore entries..
     *
     * TODO: in the end, all tokens seen there should be extracted and replaced with definition from a theme.
     * there is an internal ticket created by tnaum that describes this process and steps needed.
     */

    10: 'var(--vscode-badge-foreground)', // can't be empty
    20: 'var(--vscode-debugView-stateLabelForeground)', //var(--vscode-debugView-stateLabelForeground)
    30: 'var(--vscode-debugView-stateLabelForeground)',
    40: 'var(--vscode-debugView-stateLabelForeground)',
    50: 'var(--vscode-debugView-stateLabelForeground)',
    60: 'var(--vscode-debugView-stateLabelForeground)',
    70: 'var(--vscode-extensionButton-hoverBackground)', // button hover (and many more)
    80: 'var(--vscode-button-background)', // regular button background (and many more)
    90: 'var(--vscode-button-background)',
    100: 'var(--vscode-button-background)',
    110: 'var(--vscode-activityBarBadge-background)',
    120: 'var(--vscode-activityBarBadge-background)',
    130: 'var(--vscode-activityBarBadge-background)',
    140: 'var(--vscode-activityBarBadge-background)',
    150: 'var(--vscode-activityBarBadge-background)',
    160: 'var(--vscode-activityBarBadge-foreground)', // can't be empty
};

// get class value from body element
export const useVSCodeTheme = () => {
    return document.body.getAttribute('data-vscode-theme-kind') ?? 'vscode-light';
};

// https://react.fluentui.dev/?path=/docs/concepts-developer-theming--page#overriding-existing-tokens
export const adaptiveTheme: Theme = {
    ...createLightTheme(vscodeVariants),
    colorNeutralBackground1: 'var(--vscode-editor-background)'
};
