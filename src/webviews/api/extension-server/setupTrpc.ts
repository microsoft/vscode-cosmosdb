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
 * Sets up tRPC integration for a webview panel. Used by `BaseTab` subclasses
 * to wire a panel's `postMessage` bridge into the shared `appRouter`.
 *
 * **How it works:**
 * 1. Registers a `panel.webview.onDidReceiveMessage` listener.
 * 2. Incoming messages are parsed as {@link VsCodeLinkRequestMessage} objects
 *    containing an `op` with `type` (`query`, `mutation`, `subscription`,
 *    or `subscription.stop`) and a dot-delimited `path` (e.g. `queryEditor.runQuery`).
 * 3. For queries/mutations the procedure is invoked via `createCallerFactory`
 *    and the result (or error) is posted back to the webview.
 * 4. For subscriptions an `AbortController` is created so the webview can
 *    cancel later via `subscription.stop`. The async iterable returned by the
 *    procedure is consumed and each yielded value is forwarded to the webview.
 *
 * **Context contract:**
 * The `context` parameter must satisfy {@link BaseRouterContext} at minimum
 * (`webviewName`). Tab-specific routers expect narrower context types
 * (e.g. `QueryEditorRouterContext`, `DocumentRouterContext`) which are applied
 * automatically by the typed procedure middleware in `trpc.ts`.
 *
 * @param panel - The VS Code webview panel to attach the message listener to.
 * @param context - The router context passed to every procedure invocation.
 *   Must include at least `webviewName`. Tab routers expect additional fields
 *   (connection, sessions, etc.).
 * @returns An object containing:
 *   - `disposable` — a {@link vscode.Disposable} that removes the message listener.
 *   - `activeSubscriptions` — a `Map<string, AbortController>` tracking live subscriptions.
 *
 * @example
 * ```ts
 * const { disposable } = setupTrpc(panel, {
 *     webviewName: 'queryEditor',
 *     // ... additional context fields required by the router
 * });
 * ```
 *
 * @see {@link BaseRouterContext} for the minimal context shape.
 * @see `docs/trpc-webview-guide.md` for a full walkthrough.
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

    // Listen for panel disposal to abort all active subscriptions
    panel.onDidDispose(() => {
        for (const [id, abortController] of activeSubscriptions) {
            abortController.abort();
            activeSubscriptions.delete(id);
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
        safePostMessage(panel, response);
    } catch (error) {
        const trpcErrorMessage = wrapInTrpcErrorMessage(error, message.id);
        safePostMessage(panel, trpcErrorMessage);
    }
}
