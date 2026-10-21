/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type LogsDiagnosticReporter } from './services/advisories/fetchers/logsDiagnostics';

/** Writes sanitized query failures to local Output only, deduplicating repeats within one collection run. */
export function createLogsOutputReporter(warn: (message: string) => void): LogsDiagnosticReporter {
    const emitted = new Set<string>();
    return (diagnostic) => {
        const key = JSON.stringify([
            diagnostic.operation,
            diagnostic.kind,
            diagnostic.statusCode,
            diagnostic.codes,
            diagnostic.messages,
        ]);
        if (emitted.has(key)) {
            return;
        }
        emitted.add(key);
        const details = [
            `operation=${diagnostic.operation}`,
            'scope=resource',
            `reason=${diagnostic.reason}`,
            `kind=${diagnostic.kind}`,
            diagnostic.statusCode === undefined ? undefined : `HTTP ${diagnostic.statusCode}`,
            diagnostic.codes.length ? `code=${diagnostic.codes.join(' > ')}` : undefined,
            ...diagnostic.messages,
            diagnostic.requestId ? `requestId=${diagnostic.requestId}` : undefined,
        ].filter((part) => part !== undefined);
        const line = `[Account Overview][Log Analytics] ${details.join('; ')}`;
        warn(line);
    };
}
