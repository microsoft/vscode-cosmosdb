/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Link, makeStyles } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import React, { useCallback, useEffect, useRef } from 'react';
import { type BaseContextProvider } from './context/BaseContextProvider';

// Error boundary component must be a class component in order to catch errors (with componentDidCatch and
// getDerivedStateFromError). Wrap this with a functional component to access the useQueryEditorDispatcher hook.

export type ErrorBoundaryProps = {
    style?: React.CSSProperties;
    children?: React.ReactNode;
    provider: BaseContextProvider;
    focusOnError?: boolean;
};

export const ErrorBoundary: React.FC<ErrorBoundaryProps> = ({ style, children, provider, focusOnError }) => {
    const errorHandler = useCallback(
        (message: string, stack?: string, componentStack?: string | null) => {
            // If rendering throws right away, provider.reportWebviewError might not be initialized, yet, so check first.
            void provider?.reportWebviewError(message, stack, componentStack);
        },
        [provider],
    );
    return (
        <ErrorBoundaryComponent style={style} onError={errorHandler} provider={provider} focusOnError={focusOnError}>
            {children}
        </ErrorBoundaryComponent>
    );
};

const useStyles = makeStyles({
    container: {
        textAlign: 'center',
    },
    details: {
        textAlign: 'left',
    },
});

const ErrorDisplay: React.FC<{
    message: string | undefined;
    details: string | null | undefined;
    provider: BaseContextProvider;
    focusOnError?: boolean;
}> = ({ message, details, provider, focusOnError }) => {
    const styles = useStyles();
    const heading = useRef<HTMLHeadingElement>(null);

    useEffect(() => {
        if (focusOnError) {
            heading.current?.focus();
        }
    }, [focusOnError]);

    return (
        <div className={styles.container}>
            <h1 ref={heading} tabIndex={focusOnError ? -1 : undefined}>
                {l10n.t('An unexpected error occurred')}
            </h1>
            <p>
                {l10n.t('Please try again. If the error persists, please')}{' '}
                <Link onClick={() => void provider.executeReportIssueCommand()}>{l10n.t('report the issue')}</Link>
            </p>
            <div className={styles.details}>
                <pre>{message}</pre>
                <pre>{details}</pre>
            </div>
        </div>
    );
};

type ErrorBoundaryState = {
    hasError: boolean;
    error: Error | undefined;
    errorInfo: React.ErrorInfo | undefined;
};

type ErrorBoundaryComponentProps = {
    children: React.ReactNode;
    style?: React.CSSProperties;
    provider: BaseContextProvider;
    onError?: (message: string, stack: string | undefined, componentStack: string | null | undefined) => void;
    focusOnError?: boolean;
};

class ErrorBoundaryComponent extends React.Component<ErrorBoundaryComponentProps, ErrorBoundaryState> {
    constructor(props: ErrorBoundaryComponentProps) {
        super(props);
        this.state = { hasError: false, error: undefined, errorInfo: undefined };
    }

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { hasError: true, error, errorInfo: undefined };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
        this.props.onError?.(error.message, error.stack, errorInfo?.componentStack);

        this.setState({
            errorInfo,
        });
    }

    render(): React.ReactNode {
        if (this.state.hasError) {
            return (
                <ErrorDisplay
                    message={this.state.error?.message}
                    details={this.state.errorInfo?.componentStack}
                    provider={this.props.provider}
                    focusOnError={this.props.focusOnError}
                />
            );
        } else {
            return <div style={this.props.style}>{this.props.children}</div>;
        }
    }
}
