/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type UnavailableReason } from '../../shared';

export type LogsOperation =
    | 'probeDataPlane'
    | 'probeQueryRuntime'
    | 'crossPartition'
    | 'ingestionSummary'
    | 'ingestionBurst'
    | 'ingestionUserAgent'
    | 'sharedThroughput'
    | 'client';

export type LogsFailureKind =
    | 'accessDenied'
    | 'missingTable'
    | 'queryError'
    | 'partialFailure'
    | 'transient'
    | 'unknown'
    | 'clientUnavailable';

/** Sanitized LOCAL OUTPUT ONLY. Never attach these fields to telemetry or an error sent to telemetry. */
export interface LogsDiagnostic {
    operation: LogsOperation;
    reason: UnavailableReason;
    kind: LogsFailureKind;
    statusCode?: number;
    codes: string[];
    messages: string[];
    requestId?: string;
}

export type LogsDiagnosticReporter = (diagnostic: LogsDiagnostic) => void;

export interface LogsDiagnosticOptions {
    sensitiveValues?: readonly string[];
    partialFailure?: boolean;
}

const MAX_NODES = 64;
const MAX_DEPTH = 8;
const MAX_TEXT_LENGTH = 16_384;
const GUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

function field(value: unknown, key: string): unknown {
    if (!value || typeof value !== 'object') {
        return undefined;
    }
    try {
        return (value as Record<string, unknown>)[key];
    } catch {
        return undefined;
    }
}

function httpStatus(value: unknown): number | undefined {
    const number = typeof value === 'string' && /^\d{3}$/.test(value) ? Number(value) : value;
    return typeof number === 'number' && Number.isInteger(number) && number >= 100 && number <= 599
        ? number
        : undefined;
}

function responseRequestId(response: unknown): string | undefined {
    const headers = field(response, 'headers');
    const get = field(headers, 'get');
    if (typeof get !== 'function') {
        return undefined;
    }
    try {
        for (const name of ['x-ms-request-id', 'request-id']) {
            const value: unknown = get.call(headers, name);
            if (typeof value === 'string' && GUID.test(value)) {
                return value;
            }
        }
    } catch {
        // An unreadable optional header must not replace the service error being diagnosed.
    }
    return undefined;
}

/**
 * SDK RestError.details is an ErrorResponse ({ error }), while partialError is an ErrorInfo directly.
 * Deliberately ignore additionalProperties, target, value, resources, request, headers and raw body text.
 */
function errorFields(error: unknown): { codes: string[]; messages: string[]; statusCode?: number; requestId?: string } {
    const codes: string[] = [];
    const messages: string[] = [];
    if (typeof error === 'string' && error.trim()) {
        messages.push(
            error.length <= MAX_TEXT_LENGTH ? error : 'Server error message exceeded the diagnostic size limit.',
        );
    }
    const visited = new Set<object>();
    let remaining = MAX_NODES;
    const visit = (value: unknown, depth: number): void => {
        if (!value || typeof value !== 'object' || depth > MAX_DEPTH || remaining <= 0 || visited.has(value)) {
            return;
        }
        remaining--;
        visited.add(value);
        if (Array.isArray(value)) {
            for (const item of value.slice(0, MAX_NODES)) {
                visit(item, depth + 1);
            }
            return;
        }
        const code = field(value, 'code');
        const message = field(value, 'message');
        if (typeof code === 'string' && /^[a-z][a-z0-9_.-]{0,63}$/i.test(code) && !GUID.test(code)) {
            codes.push(code);
        }
        if (typeof message === 'string' && message.trim()) {
            messages.push(
                message.length <= MAX_TEXT_LENGTH
                    ? message
                    : 'Server error message exceeded the diagnostic size limit.',
            );
        }
        for (const key of ['innererror', 'innerError', 'error', 'details']) {
            visit(field(value, key), depth + 1);
        }
    };
    visit(error, 0);
    visit(field(field(error, 'body'), 'error'), 0);
    const response = field(error, 'response');
    visit(field(field(response, 'parsedBody'), 'error'), 0);
    const statusCode =
        httpStatus(field(error, 'statusCode')) ??
        httpStatus(field(error, 'status')) ??
        httpStatus(field(response, 'status')) ??
        httpStatus(field(response, 'statusCode'));
    const requestId = field(error, 'requestId') ?? field(response, 'requestId') ?? responseRequestId(response);
    return {
        codes: [...new Set(codes)],
        messages: [...new Set(messages)],
        statusCode,
        requestId: typeof requestId === 'string' && GUID.test(requestId) ? requestId : undefined,
    };
}

function missingCdbTable(message: string): boolean {
    const table = String.raw`['"\x60]?(?:CDBDataPlaneRequests|CDBQueryRuntimeStatistics)['"\x60]?(?![\w])`;
    return (
        new RegExp(
            String.raw`\bfailed to resolve (?:table(?: or column)?(?: expression)?|tabular expression)(?: named)?\s+${table}`,
            'i',
        ).test(message) ||
        new RegExp(
            String.raw`^\s*(?:(?:the\s+)?table\s+)?${table}\s+(?:(?:was|is|does)\s+)?(?:not (?:found|exist)|missing)\b`,
            'i',
        ).test(message) ||
        new RegExp(String.raw`\b(?:could not find|cannot find|unknown|missing)\s+table\s+${table}`, 'i').test(message)
    );
}

function classifyFields({ codes, messages, statusCode }: ReturnType<typeof errorFields>): {
    reason: UnavailableReason;
    kind: LogsFailureKind;
} {
    const normalized = codes.map((code) => code.toLowerCase().replace(/error$/, ''));
    if (
        statusCode === 401 ||
        statusCode === 403 ||
        normalized.some((code) =>
            [
                'insufficientaccess',
                'authorizationfailed',
                'authorization',
                'authorizationpermissionmismatch',
                'forbidden',
                'unauthorized',
                'unauthorizedaccess',
                'accessdenied',
                'permissiondenied',
                'insufficientpermissions',
                'authentication',
                'authenticationfailed',
                'invalidauthenticationtoken',
                'expiredauthenticationtoken',
            ].includes(code),
        )
    ) {
        return { reason: 'rbac', kind: 'accessDenied' };
    }
    if (messages.some(missingCdbTable)) {
        return { reason: 'logAnalyticsDisabled', kind: 'missingTable' };
    }
    if (normalized.some((code) => ['partial', 'partialfailure'].includes(code))) {
        return { reason: 'noData', kind: 'partialFailure' };
    }
    if (
        statusCode === 408 ||
        statusCode === 429 ||
        (statusCode !== undefined && statusCode >= 500) ||
        normalized.some((code) =>
            [
                'throttled',
                'throttling',
                'toomanyrequests',
                'timeout',
                'etimedout',
                'econnreset',
                'serviceunavailable',
            ].includes(code),
        )
    ) {
        return { reason: 'noData', kind: 'transient' };
    }
    if (
        normalized.some((code) =>
            [
                'badargument',
                'semantic',
                'syntax',
                'query',
                'queryexecution',
                'queryparsing',
                'invalidquery',
                'pathnotfound',
            ].includes(code),
        )
    ) {
        return { reason: 'noData', kind: 'queryError' };
    }
    return { reason: 'noData', kind: 'unknown' };
}

/** Pure classification; neither serializes the error nor emits diagnostics. */
export function classifyLogsFailure(error: unknown): { reason: UnavailableReason; kind: LogsFailureKind } {
    if (error instanceof LogsFetchError) {
        return { reason: error.reason, kind: error.kind };
    }
    return classifyFields(errorFields(error));
}

function sanitizeMessage(message: string, sensitiveValues: readonly string[]): string {
    let text = message;
    for (const value of [...new Set(sensitiveValues)]
        .filter((value) => value.trim())
        .sort((a, b) => b.length - a.length)) {
        const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = value.length <= 3 ? `(?<!\\w)${escaped}(?!\\w)` : escaped;
        text = text.replace(new RegExp(pattern, 'gi'), '<redacted>');
    }
    text = text
        .replace(/\{[\s\S]*|\[[\s\S]*/g, '[payload redacted]')
        .replace(/@?'(?:''|\\[\s\S]|[^'\\])*'|@?"(?:""|\\[\s\S]|[^"\\])*"|`[^`]*`/g, '[quoted-value-redacted]')
        .replace(/['"`][\s\S]*$/g, '[quoted-value-redacted]')
        .replace(/\b(?:Bearer|Basic)\s+\S+/gi, '[credential redacted]')
        .replace(/\b(?:https?|wss?):\/\/[^\s<>"']+/gi, '[URL redacted]')
        .replace(/\/(?:subscriptions|tenants|providers)\/[^\s<>"']+/gi, '[resource redacted]')
        .replace(/\b[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\b/gi, '[GUID redacted]')
        .replace(/\beyJ[a-z0-9_-]+\.[a-z0-9_-]+(?:\.[a-z0-9_-]+)?/gi, '[token redacted]')
        .replace(
            /\b(?:token|password|secret|sig|accountkey|authorization)\s*[:=]\s*[^\s,;]+/gi,
            '[credential redacted]',
        )
        .replace(/\b(?:query|kql|sql)\s*[:=][\s\S]*|\bselect\s+[\s\S]*|\|[\s\S]*/gi, '[query redacted]')
        // oxlint-disable-next-line no-control-regex -- Prevent terminal escape/control injection in local output.
        .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return text.length > 512 ? `${text.slice(0, 511)}…` : text;
}

/** Builds bounded, best-effort local diagnostics. No telemetry is emitted; never stringify the supplied error. */
export function createLogsDiagnostic(
    error: unknown,
    operation: LogsOperation,
    options: LogsDiagnosticOptions = {},
): LogsDiagnostic {
    const fields = errorFields(error);
    const classified = error instanceof LogsFetchError ? classifyLogsFailure(error) : classifyFields(fields);
    const sensitiveValues = options.sensitiveValues ?? [];
    const codes = fields.codes
        .filter(
            (code) =>
                !sensitiveValues.some(
                    (value) =>
                        value.trim() &&
                        (value.length <= 3
                            ? code.toLowerCase() === value.toLowerCase()
                            : code.toLowerCase().includes(value.toLowerCase())),
                ),
        )
        .slice(0, 16);
    const messages = [...new Set(fields.messages.map((message) => sanitizeMessage(message, sensitiveValues)))].slice(
        0,
        8,
    );
    return {
        operation,
        reason: classified.reason,
        kind:
            operation === 'client' ? 'clientUnavailable' : options.partialFailure ? 'partialFailure' : classified.kind,
        ...(fields.statusCode === undefined ? {} : { statusCode: fields.statusCode }),
        codes,
        messages: messages.length ? messages : ['No server error message was provided.'],
        ...(fields.requestId === undefined ? {} : { requestId: fields.requestId }),
    };
}

/** Category-only error safe for incidental telemetry. No raw cause, SDK response, or diagnostic message is retained. */
export class LogsFetchError extends Error {
    readonly reason: UnavailableReason;
    readonly kind: LogsFailureKind;

    constructor(diagnostic: LogsDiagnostic) {
        super(`Log query failed (${diagnostic.operation}: ${diagnostic.kind}; ${diagnostic.reason}).`);
        this.name = 'LogsFetchError';
        this.reason = diagnostic.reason;
        this.kind = diagnostic.kind;
    }
}
