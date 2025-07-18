/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { teamsDarkTheme, teamsHighContrastTheme, teamsLightTheme } from '@fluentui/react-components';
import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    type PropsWithChildren,
} from 'react';
import { generateAdaptiveDarkTheme, generateAdaptiveLightTheme, generateMonacoTheme } from '../themeGenerator';
import { defaultState, type MonacoBuiltinTheme, type MonacoTheme, type ThemeState } from './ThemeState';

export const ThemeContext = createContext<ThemeState>(defaultState);

export const useThemeMutationObserver = (callback: (themeKind: string) => void) => {
    const handlerRef = useRef(callback);

    handlerRef.current = callback;

    const observer = useMemo(
        () =>
            new MutationObserver((mutations) => {
                mutations.forEach(function (mutation) {
                    if (mutation.type === 'attributes' && mutation.attributeName === 'data-vscode-theme-kind') {
                        const newValue =
                            (mutation.target as HTMLElement).getAttribute('data-vscode-theme-kind') ?? 'vscode-light';
                        handlerRef.current(newValue);
                    }
                });
            }),
        [],
    );

    useEffect(() => {
        const targetNode = document.body;
        observer.observe(targetNode, {
            attributes: true,
        });

        return () => observer.disconnect();
    }, [observer]);
};

// get class value from body element
export const getVSCodeTheme = () => {
    return document.body.getAttribute('data-vscode-theme-kind') ?? 'vscode-light';
};

export const getFluentUiTheme = (useAdaptive: boolean = false, themeKind: string) => {
    if (useAdaptive) {
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

export const getMonacoTheme = (useAdaptive: boolean = false, themeKind: string): MonacoTheme => {
    const monacoBaseTheme: MonacoBuiltinTheme =
        themeKind === 'vscode-light'
            ? 'vs'
            : themeKind === 'vscode-dark'
              ? 'vs-dark'
              : themeKind === 'vscode-high-contrast'
                ? 'hc-black'
                : themeKind === 'vscode-high-contrast-light'
                  ? 'hc-light'
                  : 'vs';

    if (useAdaptive) {
        return {
            themeName: 'adaptive',
            theme: generateMonacoTheme(monacoBaseTheme),
        };
    }

    return {
        themeName: monacoBaseTheme,
    };
};

export function useThemeState() {
    return useContext(ThemeContext);
}

export const ThemeProvider = ThemeContext.Provider;

export const generateThemeContext = (useAdaptive: boolean = false, themeKind: string) => {
    return {
        fluentUI: {
            theme: getFluentUiTheme(useAdaptive, themeKind),
            themeKind,
        },
        monaco: getMonacoTheme(useAdaptive, themeKind),
        useAdaptive,
        themeKind,
    };
};

export const WithTheme = ({ children, useAdaptive }: PropsWithChildren<{ useAdaptive?: boolean }>) => {
    const [state, setState] = useState(generateThemeContext(useAdaptive, getVSCodeTheme()));

    const setThemeKind = useCallback(
        (themeKind: string) => setState(generateThemeContext(useAdaptive, themeKind)),
        [useAdaptive],
    );

    useEffect(() => setThemeKind(getVSCodeTheme()), [setThemeKind]);

    useThemeMutationObserver(setThemeKind);

    return <ThemeProvider value={state}>{children}</ThemeProvider>;
};
