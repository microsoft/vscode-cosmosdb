/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Link, Toast, ToastBody, ToastTitle, ToastTrigger, type useToastController } from '@fluentui/react-components';
import { type TRPCClient } from '@trpc/client';
import { type AnyRouter } from '@trpc/server';
import * as l10n from '@vscode/l10n';

export type DispatchToastFn = ReturnType<typeof useToastController>['dispatchToast'];

/**
 * Common routes interface for the base context provider.
 * Both QueryEditorAppRouter and DocumentAppRouter include these routes
 * via the `buildCommonRouter` factory.
 */
interface CommonRoutes {
    common: {
        showInformationMessage: { mutate: (input: { message: string }) => Promise<void> };
        showErrorMessage: { mutate: (input: { message: string }) => Promise<void> };
        openUrl: { mutate: (input: { url: string }) => Promise<void> };
        reportEvent: {
            mutate: (input: {
                eventName: string;
                properties?: Record<string, string>;
                measurements?: Record<string, number>;
            }) => Promise<void>;
        };
        reportError: {
            mutate: (input: { message: string; stack: string; componentStack?: string }) => Promise<void>;
        };
        executeReportIssueCommand: { mutate: () => Promise<void> };
    };
}

export class BaseContextProvider<TRouter extends AnyRouter = AnyRouter> {
    constructor(
        protected readonly dispatchToast: DispatchToastFn,
        protected readonly trpcClient: TRPCClient<TRouter>,
    ) {
        this.initEventListeners();
        this.init();
    }

    /** Type-safe accessor for common routes available on all app routers. */
    private get common(): CommonRoutes['common'] | undefined {
        return (this.trpcClient as unknown as CommonRoutes)?.common;
    }

    public async showInformationMessage(message: string) {
        await this.common?.showInformationMessage.mutate({ message });
    }
    public async showErrorMessage(message: string) {
        await this.common?.showErrorMessage.mutate({ message });
    }
    public async openUrl(url: string) {
        await this.common?.openUrl.mutate({ url });
    }

    public showToast(title: string, message: string, intent: 'info' | 'error' = 'info') {
        this.dispatchToast(
            <Toast>
                <ToastTitle
                    action={
                        <ToastTrigger>
                            <Link>{l10n.t('Dismiss')}</Link>
                        </ToastTrigger>
                    }
                >
                    {title}
                </ToastTitle>
                <ToastBody style={{ whiteSpace: 'pre-wrap' }}>{message}</ToastBody>
            </Toast>,
            {
                intent,
                pauseOnHover: true,
                pauseOnWindowBlur: true,
                timeout: 5000,
            },
        );
    }

    public async reportWebviewEvent(
        eventName: string,
        properties: Record<string, string> = {},
        measurements: Record<string, number> = {},
    ) {
        await this.common?.reportEvent.mutate({ eventName, properties, measurements });
    }
    public async reportWebviewError(
        message: string,
        stack: string | undefined,
        componentStack: string | null | undefined,
    ) {
        await this.common?.reportError.mutate({
            message,
            stack: stack ?? '',
            componentStack: componentStack ?? undefined,
        });
    }
    public async executeReportIssueCommand() {
        await this.common?.executeReportIssueCommand.mutate();
    }

    /**
     * Wraps a tRPC call so that errors are silently caught and the caller
     * receives `undefined` instead of an exception. Error *display* is handled
     * globally by the `errorLink` middleware in the tRPC client chain.
     */
    protected async safeMutate<T>(fn: () => Promise<T>): Promise<T | undefined> {
        try {
            return await fn();
        } catch {
            // Error notification is handled by the errorLink middleware
            return undefined;
        }
    }

    public dispose() {
        // Override in subclasses if cleanup is needed
    }

    protected initEventListeners(): void {
        // Override in subclasses to set up tRPC event subscriptions
    }

    protected init(): void {
        // Override in subclasses to trigger tRPC initialization
    }
}
