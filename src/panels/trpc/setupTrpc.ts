/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getTRPCErrorFromUnknown, type AnyRouter } from '@trpc/server';
import * as l10n from '@vscode/l10n';
import type * as vscode from 'vscode';
import { type BaseRouterContext } from './appRouter';
import { type VsCodeLinkRequestMessage } from './vscodeProtocol';

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
 * Safely posts a message to the webview panel.
 * Returns false if the panel has already been disposed.
 */
function safePostMessage(panel: vscode.WebviewPanel, message: unknown): boolean {
    try {
        void panel.webview.postMessage(message);
        return true;
    } catch {
        // Panel was disposed between our check and the actual call
        return false;
    }
}

/**
 * Sets up tRPC integration for a webview panel.
 *
 * Each webview type (QueryEditor, Document) has its own tRPC instance with a
 * properly typed context. The caller passes the specific `appRouter` and
 * `createCallerFactory` from that instance.
 *
 * @param panel - The VS Code webview panel to attach the message listener to.
 * @param context - The router context passed to every procedure invocation.
 * @param appRouter - The tRPC router for this webview type.
 * @param createCallerFactory - The `createCallerFactory` function from the
 *   tRPC instance that created `appRouter`.
 */
export function setupTrpc<TContext extends BaseRouterContext, TRouter extends AnyRouter>(
    panel: vscode.WebviewPanel,
    context: TContext,
    appRouter: TRouter,
    createCallerFactory: (router: TRouter) => (ctx: TContext) => Record<string, unknown>,
): { disposable: vscode.Disposable; activeSubscriptions: Map<string, AbortController> } {
    const activeSubscriptions = new Map<string, AbortController>();

    const disposable = panel.webview.onDidReceiveMessage(async (message: VsCodeLinkRequestMessage) => {
        switch (message.op.type) {
            case 'subscription':
                await handleSubscriptionMessage(
                    panel,
                    message,
                    context,
                    activeSubscriptions,
                    appRouter,
                    createCallerFactory,
                );
                break;

            case 'subscription.stop':
                handleSubscriptionStopMessage(message, activeSubscriptions);
                break;

            default:
                await handleDefaultMessage(panel, message, context, appRouter, createCallerFactory);
                break;
        }
    });

    // Listen for panel disposal to abort all active subscriptions
    panel.onDidDispose(() => {
        for (const [id, abortController] of activeSubscriptions) {
            abortController.abort();
            activeSubscriptions.delete(id);
        }
    });

    return { disposable, activeSubscriptions };
}

async function handleSubscriptionMessage<TContext extends BaseRouterContext, TRouter extends AnyRouter>(
    panel: vscode.WebviewPanel,
    message: VsCodeLinkRequestMessage,
    context: TContext,
    activeSubscriptions: Map<string, AbortController>,
    appRouter: TRouter,
    createCallerFactory: (router: TRouter) => (ctx: TContext) => Record<string, unknown>,
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
                    safePostMessage(panel, { id: message.id, result: value });
                }

                safePostMessage(panel, { id: message.id, complete: true });
            } catch (error) {
                const trpcErrorMessage = wrapInTrpcErrorMessage(error, message.id);
                safePostMessage(panel, trpcErrorMessage);
            } finally {
                activeSubscriptions.delete(message.id);
            }
        })();
    } catch (error) {
        const trpcErrorMessage = wrapInTrpcErrorMessage(error, message.id);
        safePostMessage(panel, trpcErrorMessage);
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

async function handleDefaultMessage<TContext extends BaseRouterContext, TRouter extends AnyRouter>(
    panel: vscode.WebviewPanel,
    message: VsCodeLinkRequestMessage,
    context: TContext,
    appRouter: TRouter,
    createCallerFactory: (router: TRouter) => (ctx: TContext) => Record<string, unknown>,
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
        safePostMessage(panel, response);
    } catch (error) {
        const trpcErrorMessage = wrapInTrpcErrorMessage(error, message.id);
        safePostMessage(panel, trpcErrorMessage);
    }
}
