/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Link, Toast, ToastBody, ToastTitle, ToastTrigger, type useToastController } from '@fluentui/react-components';
import { type TRPCClient } from '@trpc/client';
import * as l10n from '@vscode/l10n';
import { type AppRouter } from '../../api/configuration/appRouter';

export type DispatchToastFn = ReturnType<typeof useToastController>['dispatchToast'];

/**
 * Type alias for the tRPC client used by context providers.
 */
export type TrpcClient = TRPCClient<AppRouter>;

export class BaseContextProvider {
    constructor(
        protected readonly dispatchToast: DispatchToastFn,
        protected readonly trpcClient?: TrpcClient,
    ) {
        this.initEventListeners();
        this.init();
    }

    public async showInformationMessage(message: string) {
        await this.trpcClient?.common.showInformationMessage.mutate({ message });
    }
    public async showErrorMessage(message: string) {
        await this.trpcClient?.common.showErrorMessage.mutate({ message });
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
        await this.trpcClient?.common.reportEvent.mutate({ eventName, properties, measurements });
    }
    public async reportWebviewError(
        message: string,
        stack: string | undefined,
        componentStack: string | null | undefined,
    ) {
        await this.trpcClient?.common.reportError.mutate({
            message,
            stack: stack ?? '',
            componentStack: componentStack ?? undefined,
        });
    }
    public async executeReportIssueCommand() {
        await this.trpcClient?.common.executeReportIssueCommand.mutate();
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
