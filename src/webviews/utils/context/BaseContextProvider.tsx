/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Link, Toast, ToastBody, ToastTitle, ToastTrigger } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import type * as React from 'react';
import { type Channel } from '../../../panels/Communication/Channel/Channel';
import { getErrorMessage } from '../../../panels/Communication/Channel/CommonChannel';

export class BaseContextProvider {
    constructor(
        protected readonly channel: Channel,
        protected readonly dispatchToast: (content: React.ReactNode, options?: unknown) => void,
    ) {
        this.initEventListeners();
        this.init();
    }

    public async showInformationMessage(message: string) {
        await this.sendCommand('showInformationMessage', message);
    }
    public async showErrorMessage(message: string) {
        await this.sendCommand('showErrorMessage', message);
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
        await this.sendCommand('reportWebviewEvent', eventName, properties, measurements);
    }
    public async reportWebviewError(
        message: string,
        stack: string | undefined,
        componentStack: string | null | undefined,
    ) {
        // Error is not JSON serializable, so the original Error object cannot be sent to the webview host.
        // Send only the relevant fields
        await this.sendCommand('reportWebviewError', message, stack, componentStack);
    }
    public async executeReportIssueCommand() {
        await this.sendCommand('executeReportIssueCommand');
    }

    public dispose() {
        this.channel.removeAllListeners();
    }

    protected async sendCommand(command: string, ...args: unknown[]): Promise<void> {
        const removeTrailingUndefined = (args: unknown[]) => {
            while (args.length > 0 && args[args.length - 1] === undefined) {
                args.pop();
            }
            return args;
        };

        try {
            // Don't remove await here, we need to catch the error
            await this.channel.postMessage({
                type: 'event',
                name: 'command',
                params: [
                    {
                        commandName: command,
                        params: removeTrailingUndefined(args),
                    },
                ],
            });
        } catch (error) {
            try {
                await this.showErrorMessage(
                    l10n.t('Failed to execute command {command}: {error}', {
                        command,
                        error: getErrorMessage(error),
                    }),
                );
            } catch {
                // Ignore
            }
        }
    }

    protected initEventListeners(): void {
        this.channel.on('showInformationMessage', (title: string, message: string) => {
            this.showToast(title, message, 'info');
        });

        this.channel.on('showErrorMessage', (title: string, message: string) => {
            this.showToast(title, message, 'error');
        });
    }

    protected init(): void {
        void this.channel.postMessage({ type: 'event', name: 'ready', params: [] });
    }
}
