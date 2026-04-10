/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Protocol message types for webview ↔ extension tRPC communication.
 * Shared between the tRPC server (extension) and client (webview).
 */

import { type Operation } from '@trpc/client';

type StopOperation<TInput = unknown> = Omit<Operation<TInput>, 'type'> & {
    type: 'subscription.stop';
};

/**
 * Messages sent from the webview/client to the extension/server.
 * @id - A unique identifier for the message.
 */
export interface VsCodeLinkRequestMessage {
    id: string;
    // TODO, when tRPC v12 is released, 'subscription.stop' should be supported natively, until then, we're adding it manually.
    op: Operation<unknown> | StopOperation<unknown>;
}

/**
 * Messages sent back from the extension/server to the webview/client.
 * Each message sent back is a **response** to a previous VsCodeLinkRequestMessage.
 *
 * @id - The unique identifier of the message from the original request.
 */
export interface VsCodeLinkResponseMessage {
    id: string;
    result?: unknown;
    error?: {
        name: string;
        message: string;
        code?: number;
        stack?: string;
        cause?: unknown;
        data?: unknown;
    };
    complete?: boolean;
}
