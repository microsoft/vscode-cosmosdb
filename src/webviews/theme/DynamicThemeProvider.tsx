import { FluentProvider, teamsDarkTheme, teamsHighContrastTheme, teamsLightTheme } from '@fluentui/react-components';
import { useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import { generateAdaptiveDarkTheme, generateAdaptiveLightTheme, useVSCodeTheme } from './themeGenerator';

const observerConfig = {
    attributes: true,
};

export const useThemeMutationObserver = (callback: (themeKind: string) => void) => {
    const observer = useMemo(
        () =>
            new MutationObserver((mutations) => {
                mutations.forEach(function (mutation) {
                    if (mutation.type === 'attributes' && mutation.attributeName === 'data-vscode-theme-kind') {
                        console.log('theme attributes changed');

                        const newValue =
                            (mutation.target as HTMLElement).getAttribute('data-vscode-theme-kind') ?? 'vscode-light';
                        callback(newValue);
                    }
                });
            }),
        [callback],
    );

    useEffect(() => {
        const targetNode = document.body;
        observer.observe(targetNode, observerConfig);

        return () => observer.disconnect();
    }, [observer]);
};

export type DynamicThemeProviderProps = {
    useAdaptive?: boolean;
};

const getFluentUiTheme = (isAdaptive: boolean = false, themeKind: string) => {
    if (isAdaptive) {
        return themeKind === 'vscode-light'
            ? generateAdaptiveLightTheme()
            : themeKind === 'vscode-dark'
              ? generateAdaptiveDarkTheme()
              : themeKind === 'vscode-high-contrast'
                ? teamsHighContrastTheme
                : themeKind === 'vscode-high-contrast-light'
                  ? teamsLightTheme // TODO: find a better theme for this
                  : undefined;
    }
    return themeKind === 'vscode-light'
        ? teamsLightTheme
        : themeKind === 'vscode-dark'
          ? teamsDarkTheme
          : themeKind === 'vscode-high-contrast'
            ? teamsHighContrastTheme
            : themeKind === 'vscode-high-contrast-light'
              ? teamsLightTheme // TODO: find a better theme for this
              : undefined;
};

export const DynamicThemeProvider = ({ children, useAdaptive }: PropsWithChildren<DynamicThemeProviderProps>) => {
    const [themeKind, setThemeKind] = useState(useVSCodeTheme());
    const [theme, setTheme] = useState(getFluentUiTheme(useAdaptive, themeKind));

    useThemeMutationObserver((themeKind) => {
        setThemeKind(themeKind);
        setTheme(getFluentUiTheme(useAdaptive, themeKind));
    });

    return <FluentProvider theme={theme}>{children}</FluentProvider>;
};
