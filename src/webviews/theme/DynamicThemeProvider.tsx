import { FluentProvider } from '@fluentui/react-components';
import { type PropsWithChildren, type ReactNode } from 'react';
import { useThemeState, WithTheme } from './state/ThemeContext';

export type DynamicThemeProviderProps = {
    useAdaptive?: boolean;
};

const FluentUiProvider = ({ children }: { children: ReactNode }) => {
    const themeState = useThemeState();

    return <FluentProvider theme={themeState.fluentUI.theme}>{children}</FluentProvider>;
};

export const DynamicThemeProvider = ({
    children,
    useAdaptive = false,
}: PropsWithChildren<DynamicThemeProviderProps>) => {
    return (
        <WithTheme useAdaptive={useAdaptive}>
            <FluentUiProvider>{children}</FluentUiProvider>
        </WithTheme>
    );
};
