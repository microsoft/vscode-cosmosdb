/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { formatErrorDiagnostic, type LogsDiagnosticReporter } from './services/advisories/fetchers/logsDiagnostics';

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
        warn(formatErrorDiagnostic(diagnostic, '[Account Overview][Log Analytics]'));
    };
}
