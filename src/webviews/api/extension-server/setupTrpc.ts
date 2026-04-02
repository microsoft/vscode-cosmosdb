/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getTRPCErrorFromUnknown } from '@trpc/server';
import * as l10n from '@vscode/l10n';
import type * as vscode from 'vscode';
import { appRouter, type BaseRouterContext } from '../configuration/appRouter';
import { type VsCodeLinkRequestMessage } from '../webview-client/vscodeLink';
import { createCallerFactory } from './trpc';

/**
 * Converts an unknown error into a tRPC-compatible error response.
 */
function wrapInTrpcErrorMessage(error: unknown, operationId: string) {
    const errorEntry = getTRPCErrorFromUnknown(error);

    return {
        id: operationId,
        error: {
            code: errorEntry.code,
            name: errorEntry.name,
            message: errorEntry.message,
            stack: errorEntry.stack,
            cause: errorEntry.cause,
        },
    };
}

/**
 * Sets up tRPC integration for a webview panel. This is a standalone utility
 * that can be used by both `WebviewController` and `BaseTab` subclasses.
 *
 * Listens for messages from the webview, parses them as tRPC operations
 * (queries, mutations, subscriptions, or subscription stops), invokes the
 * appropriate server-side procedures, and returns results or errors.
 *
 * @param panel - The webview panel to wire up.
 * @param context - The base router context for procedure calls.
 * @returns A disposable that removes the message listener plus a map of active subscriptions.
 */
export function setupTrpc(
    panel: vscode.WebviewPanel,
    context: BaseRouterContext,
): { disposable: vscode.Disposable; activeSubscriptions: Map<string, AbortController> } {
    const activeSubscriptions = new Map<string, AbortController>();

    const disposable = panel.webview.onDidReceiveMessage(async (message: VsCodeLinkRequestMessage) => {
        switch (message.op.type) {
            case 'subscription':
                await handleSubscriptionMessage(panel, message, context, activeSubscriptions);
                break;

            case 'subscription.stop':
                handleSubscriptionStopMessage(message, activeSubscriptions);
                break;

            default:
                await handleDefaultMessage(panel, message, context);
                break;
        }
    });

    return { disposable, activeSubscriptions };
}

async function handleSubscriptionMessage(
    panel: vscode.WebviewPanel,
    message: VsCodeLinkRequestMessage,
    context: BaseRouterContext,
    activeSubscriptions: Map<string, AbortController>,
) {
    try {
        const callerFactory = createCallerFactory(appRouter);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const caller = callerFactory(context) as Record<string, any>;

        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const procedure = caller[message.op.path];

        if (typeof procedure !== 'function') {
            throw new Error(l10n.t('Procedure not found: {name}', { name: message.op.path }));
        }

        const abortController = new AbortController();
        activeSubscriptions.set(message.id, abortController);

        context.signal = abortController.signal;

        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
        const asyncIter = await procedure(message.op.input);

        void (async () => {
            try {
                for await (const value of asyncIter) {
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                    panel.webview.postMessage({ id: message.id, result: value });
                }

                panel.webview.postMessage({ id: message.id, complete: true });
            } catch (error) {
                const trpcErrorMessage = wrapInTrpcErrorMessage(error, message.id);
                panel.webview.postMessage(trpcErrorMessage);
            } finally {
                activeSubscriptions.delete(message.id);
            }
        })();
    } catch (error) {
        const trpcErrorMessage = wrapInTrpcErrorMessage(error, message.id);
        panel.webview.postMessage(trpcErrorMessage);
    }
}

function handleSubscriptionStopMessage(
    message: VsCodeLinkRequestMessage,
    activeSubscriptions: Map<string, AbortController>,
) {
    const abortController = activeSubscriptions.get(message.id);
    if (abortController) {
        abortController.abort();
        activeSubscriptions.delete(message.id);
    }
}

async function handleDefaultMessage(
    panel: vscode.WebviewPanel,
    message: VsCodeLinkRequestMessage,
    context: BaseRouterContext,
) {
    try {
        const callerFactory = createCallerFactory(appRouter);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const caller = callerFactory(context) as Record<string, any>;

        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const procedure = caller[message.op.path];

        if (typeof procedure !== 'function') {
            throw new Error(l10n.t('Procedure not found: {name}', { name: message.op.path }));
        }

        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
        const result = await procedure(message.op.input);

        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const response = { id: message.id, result };
        panel.webview.postMessage(response);
    } catch (error) {
        const trpcErrorMessage = wrapInTrpcErrorMessage(error, message.id);
        panel.webview.postMessage(trpcErrorMessage);
    }
}
