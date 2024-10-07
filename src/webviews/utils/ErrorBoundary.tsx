/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Link, makeStyles } from "@fluentui/react-components";
import React from "react";
import { useQueryEditorDispatcher } from "../QueryEditor/state/QueryEditorContext";

// Error boundary component must be a class component in order to catch errors (with componentDidCatch and
// getDerivedStateFromError). Wrap this with a functional component to access the useQueryEditorDispatcher hook.

export const ErrorBoundary: React.FC<{ style?: React.CSSProperties, children?: React.ReactNode }> = ({ style, children }) => {
    const dispatcher = useQueryEditorDispatcher();
    return <ErrorBoundaryComponent style={style} onError={(message, stack, componentStack) =>
        // If rendering throws right away, dispatcher.reportError might not be initialized, yet, so check first.
        dispatcher.reportWebviewError && void dispatcher.reportWebviewError(message, stack, componentStack)} children={children} />;
}

const useStyles = makeStyles({
    container: {
        textAlign: 'center',
    },
    details:
    {
        textAlign: 'left',
    }
});

const ErrorDisplay: React.FC<{ message: string | undefined, details: string | null | undefined }> = ({ message, details }) => {
    const dispatcher = useQueryEditorDispatcher();
    const styles = useStyles();
    return <div className={styles.container}>
        <h1>An unexpected error occurred</h1>
        <p>Please try again. If the error persists, please <Link onClick={() => void dispatcher.executeReportIssueCommand()}>report the issue</Link></p>
        <div className={styles.details}>
            <pre>{message}</pre>
            <pre>{details}</pre>
        </div>
    </div>;
}

type ErrorBoundaryState = {
    hasError: boolean;
    error: Error | undefined;
    errorInfo: React.ErrorInfo | undefined;
};

type ErrorBoundaryProps = {
    children: React.ReactNode;
    style?: React.CSSProperties;
    onError?: (message: string, stack: string | undefined, componentStack: string | null | undefined) => void;
};

class ErrorBoundaryComponent extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
    constructor(props: ErrorBoundaryProps) {
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
            return <ErrorDisplay message={this.state.error?.message} details={this.state.errorInfo?.componentStack} />;
        } else {
            return <div style={this.props.style}>
                {this.props.children}
            </div>;
        }
    }
}
