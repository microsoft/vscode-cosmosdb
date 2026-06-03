/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type TypedEventSink } from '@cosmosdb/webview-rpc';
import * as vscode from 'vscode';
import { ext } from '../../../extensionVariables';
import { MigrationProjectService } from '../../../services/MigrationProjectService';
import {
    type MigrationEvent,
    type MigrationEventName,
    type MigrationEventPayloads,
    type MigrationProgressEventName,
} from '../../trpc/routers/migrationEventsRouter';
import { type CosmosModel } from '../cosmosModel';

// ─── File I/O ────────────────────────────────────────────────────────

export async function saveCosmosModel(domainOutputPath: string, cosmosModel: CosmosModel): Promise<void> {
    await vscode.workspace.fs.writeFile(
        MigrationProjectService.toUri(domainOutputPath, 'cosmos-model.json'),
        Buffer.from(JSON.stringify(cosmosModel, cosmosModelJsonReplacer, 2), 'utf-8'),
    );
}

/**
 * JSON.stringify replacer that drops boolean-flag attribute properties
 * (`isId`, `isPartitionKey`) when they are not explicitly `true`. The LLM
 * frequently emits `null` for these on non-key attributes; consumers only
 * check `=== true`, so omitting them entirely keeps the saved JSON minimal
 * and consistent with the `isId?: boolean` / `isPartitionKey?: boolean`
 * type definitions.
 */
function cosmosModelJsonReplacer(key: string, value: unknown): unknown {
    if ((key === 'isId' || key === 'isPartitionKey') && value !== true) {
        return undefined;
    }
    return value;
}

export async function saveAnalysisFile(domainOutputPath: string, fileName: string, content: string): Promise<void> {
    await vscode.workspace.fs.writeFile(
        MigrationProjectService.toUri(domainOutputPath, fileName),
        Buffer.from(content, 'utf-8'),
    );
}

// ─── Model Cleanup ──────────────────────────────────────────────────

/**
 * Returns a deep-cloned copy of the model with prose fields stripped from
 * the JSON so the saved model.json stays a pure structural artifact:
 *  - `candidates` and `analysis` are removed from each `PartitionKeyConfig`.
 *  - `rationale` and `score` are removed from each `EntityRelationship`.
 *
 * Free-form rationale for partition-key and embed/reference decisions
 * belongs in summary.md, not in the model JSON. The model may still emit
 * these fields (legacy prompts or LLM drift); this strip guarantees the
 * saved JSON is clean regardless.
 *
 * Does NOT mutate the original model.
 */
export function stripPartitionKeyCandidates(model: CosmosModel): CosmosModel {
    return {
        ...model,
        containers: model.containers.map((container) => ({
            ...container,
            partitionKeys: container.partitionKeys?.map(({ path }) => ({ path })),
            entities: container.entities.map((entity) => ({
                ...entity,
                relationships: entity.relationships?.map(({ rationale: _r, score: _s, ...rest }) => rest),
            })),
        })),
    };
}

// ─── Progress / Events ──────────────────────────────────────────────

export async function sendPhaseProgress<N extends MigrationProgressEventName>(
    channel: TypedEventSink<MigrationEvent>,
    logTag: string,
    eventName: N,
    message: string,
): Promise<void> {
    ext.outputChannel.appendLog(`[${logTag}] ${message}`);
    emitMigrationEvent(channel, eventName, [message] as MigrationEventPayloads[N]);
}

export async function sendPhaseEvent<N extends MigrationEventName>(
    channel: TypedEventSink<MigrationEvent>,
    name: N,
    ...params: MigrationEventPayloads[N] extends [] ? [] : [params: MigrationEventPayloads[N]]
): Promise<void> {
    emitMigrationEvent(channel, name, (params[0] ?? []) as MigrationEventPayloads[N]);
}

/**
 * Type-safe emit for a single `MigrationEvent`. Use at sites that have a
 * `TypedEventSink<MigrationEvent>` in hand and need to push a named event
 * with strongly-typed params (the compiler enforces `params` matches `name`).
 *
 * The internal cast bridges a TypeScript limitation: the union is
 * discriminated by `type` (always `'event'`), so the compiler cannot
 * narrow object literals by `name` to a single variant.
 */
export function emitMigrationEvent<N extends MigrationEventName>(
    channel: TypedEventSink<MigrationEvent>,
    name: N,
    params: MigrationEventPayloads[N],
): void {
    channel.emit({ type: 'event', name, params } as MigrationEvent);
}

// ─── Cancellation ───────────────────────────────────────────────────

/**
 * Cancels and disposes an existing `CancellationTokenSource`, then creates
 * and returns a fresh one.
 */
export function resetCancellationToken(
    existing: vscode.CancellationTokenSource | undefined,
): vscode.CancellationTokenSource {
    existing?.cancel();
    existing?.dispose();
    return new vscode.CancellationTokenSource();
}

// ─── Formatting ─────────────────────────────────────────────────────

const languageToFence: Record<string, string> = {
    'c#': 'csharp',
    csharp: 'csharp',
    java: 'java',
    typescript: 'typescript',
    javascript: 'javascript',
    python: 'python',
    go: 'go',
    ruby: 'ruby',
    php: 'php',
    rust: 'rust',
    kotlin: 'kotlin',
    scala: 'scala',
    swift: 'swift',
};

function toFenceLanguage(language: string): string {
    return languageToFence[language.toLowerCase()] ?? '';
}

export function formatDomainMarkdown(
    domain: {
        name: string;
        description: string;
        tables: string[];
        rationale: string;
        aggregateRoot: string;
        crossDomainDependencies: string[];
        estimatedTokens: number;
        recommendations: string[];
        accessPatterns?: {
            name: string;
            type: string;
            tables: string[];
            frequency: string;
            codeReferences?: string[];
            filterFields?: string;
            singleOrBatch?: string;
            sqlExample?: string;
            codeExample?: string;
        }[];
    },
    pathToRoot?: string,
    language?: string,
): string {
    const codeFence = language ? toFenceLanguage(language) : '';
    const lines: string[] = [];
    lines.push(`# Domain: ${domain.name}`);
    lines.push('');
    lines.push(domain.description);
    lines.push('');
    lines.push('## Rationale');
    lines.push('');
    lines.push(domain.rationale);
    lines.push('');
    lines.push(`## Aggregate Root: ${domain.aggregateRoot}`);
    lines.push('');
    lines.push('## Tables');
    lines.push('');
    for (const table of domain.tables) {
        lines.push(`- ${table}`);
    }
    lines.push('');
    lines.push(`## Estimated Tokens: ${domain.estimatedTokens.toLocaleString()}`);
    lines.push('');
    if (domain.accessPatterns && domain.accessPatterns.length > 0) {
        lines.push('## Access Patterns');
        lines.push('');
        for (const pattern of domain.accessPatterns) {
            lines.push(`### ${pattern.name}`);
            lines.push('');
            lines.push(`- **Type:** ${pattern.type}`);
            lines.push(`- **Tables:** ${pattern.tables.join(', ')}`);
            lines.push(`- **Frequency:** ${pattern.frequency}`);
            if (pattern.filterFields) {
                lines.push(`- **Filter/Lookup Fields:** ${pattern.filterFields}`);
            }
            if (pattern.singleOrBatch) {
                lines.push(`- **Single / Batch:** ${pattern.singleOrBatch}`);
            }
            if (pattern.codeReferences && pattern.codeReferences.length > 0) {
                const refs = pattern.codeReferences.map((ref) => (pathToRoot ? `[${ref}](${pathToRoot}/${ref})` : ref));
                lines.push(`- **Code References:** ${refs.join(', ')}`);
            }
            lines.push('');
            if (pattern.sqlExample) {
                lines.push('```sql');
                lines.push(pattern.sqlExample);
                lines.push('```');
                lines.push('');
            }
            if (pattern.codeExample) {
                lines.push(codeFence ? '```' + codeFence : '```');
                lines.push(pattern.codeExample);
                lines.push('```');
                lines.push('');
            }
        }
    }
    if (domain.crossDomainDependencies.length > 0) {
        lines.push('## Cross-Domain Dependencies');
        lines.push('');
        for (const dep of domain.crossDomainDependencies) {
            lines.push(`- ${dep}`);
        }
        lines.push('');
    }
    if (domain.recommendations.length > 0) {
        lines.push('## Recommendations');
        lines.push('');
        for (const rec of domain.recommendations) {
            lines.push(`- ${rec}`);
        }
        lines.push('');
    }
    return lines.join('\n');
}

// ─── Access Pattern Types ───────────────────────────────────────────

/**
 * Represents a single access pattern extracted from a discovery report.
 */
export interface ParsedAccessPattern {
    name: string;
    type: string;
    tables: string[];
    frequency: string;
    codeReferences: string[];
    filterFields?: string;
    singleOrBatch?: string;
    sqlExample?: string;
    codeExample?: string;
}

/**
 * Assigns pre-parsed access patterns to domains based on table overlap.
 * A pattern is assigned to a domain if any of its tables belong to that domain.
 */
export function assignAccessPatternsToDomains<T extends { tables: string[] }>(
    domains: T[],
    patterns: ParsedAccessPattern[],
): (T & { accessPatterns: ParsedAccessPattern[] })[] {
    return domains.map((domain) => {
        const domainTableSet = new Set(domain.tables.map((t) => t.toLowerCase()));
        const matched = patterns.filter((p) => p.tables.some((t) => domainTableSet.has(t.toLowerCase())));
        return { ...domain, accessPatterns: matched };
    });
}
