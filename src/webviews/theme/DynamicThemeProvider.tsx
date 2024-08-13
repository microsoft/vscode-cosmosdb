import { FluentProvider, teamsDarkTheme, teamsHighContrastTheme, teamsLightTheme } from '@fluentui/react-components';
import { useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import { adaptiveTheme, useVSCodeTheme } from '../themeGenerator';

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

export const DynamicThemeProvider = ({ children, useAdaptive }: PropsWithChildren<DynamicThemeProviderProps>) => {
    const [themeKind, setThemeKind] = useState(useVSCodeTheme());

    useThemeMutationObserver(setThemeKind);

    const getFluentUiTheme = (isAdaptive: boolean = false, themeKind: string) => {
        return isAdaptive
            ? adaptiveTheme
            : themeKind === 'vscode-light'
              ? teamsLightTheme
              : themeKind === 'vscode-dark'
                ? teamsDarkTheme
                : themeKind === 'vscode-high-contrast'
                  ? teamsHighContrastTheme
                  : themeKind === 'vscode-high-contrast-light'
                    ? teamsLightTheme // TODO: find a better theme for this
                    : undefined;
    };

    return <FluentProvider theme={getFluentUiTheme(useAdaptive, themeKind)}>{children}</FluentProvider>;
};
