/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cosmosdb-specific {@link ProcedureLogger} that writes one line per
 * procedure completion to the extension's `vscode.LogOutputChannel`
 * (`ext.outputChannel`).
 *
 * This is the only logger that has access to `ext.outputChannel`; the
 * framework-level `loggingMiddleware.ts` only knows about the
 * structural `ProcedureLogger` interface so it can be reused in other
 * environments (tests, future packages, …).
 *
 * Format: `[trpc] mutation queryEditor.runQuery 42.0ms ok`
 */

import { type ProcedureLogger } from '@cosmosdb/webview-rpc/server';
import { ext } from '../../../extensionVariables';

/**
 * Logger backed by `ext.outputChannel`. Successful calls go to `.debug`
 * (hidden by default unless the user lifts the log level), failures go
 * to `.warn` so they stand out without forcing the channel open.
 *
 * Resolved lazily because `ext.outputChannel` is wired during extension
 * activation; webview tabs may be constructed in tests where it is
 * unset, in which case we fall back to `console.*`.
 */
export const outputChannelProcedureLogger: ProcedureLogger = {
    onEnd({ path, type, durationMs, ok, aborted, error }) {
        const outcome = aborted ? 'canceled' : ok ? 'ok' : `error: ${error?.message ?? '(unknown)'}`;
        const line = `[trpc] ${type} ${path} ${durationMs.toFixed(1)}ms ${outcome}`;

        const channel = tryGetOutputChannel();
        if (channel) {
            // Canceled and successful calls go to debug so they stay out of
            // the way; errors get warn so they surface in the channel header.
            if (aborted || ok) {
                channel.debug(line);
            } else {
                channel.warn(line);
            }
            return;
        }

        if (aborted || ok) {
            console.debug(line);
        } else {
            console.warn(line);
        }
    },
};

/**
 * `ext.outputChannel` is backed by a `required<…>()` slot that throws
 * before extension activation. The middleware can be constructed during
 * test setup or very early activation, so we tolerate that and fall
 * back to `console.*`.
 */
function tryGetOutputChannel(): typeof ext.outputChannel | undefined {
    try {
        return ext.outputChannel;
    } catch {
        return undefined;
    }
}
