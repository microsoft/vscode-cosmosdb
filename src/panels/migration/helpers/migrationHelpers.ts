/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type TypedEventSink } from '@microsoft/vscode-ext-webview';
import * as vscode from 'vscode';
import { ext } from '../../../extensionVariables';
import { MigrationProjectService } from '../../../services/MigrationProjectService';
import {
    type MigrationEvent,
    type MigrationEventName,
    type MigrationEventPayloads,
    type MigrationProgressEventName,
} from '../../trpc/routers/migrationEventsRouter';
import { type CosmosContainer, type CosmosModel, type IndexingPolicy } from '../cosmosModel';

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

export function mergeDomainModels(domainModels: { domainName: string; model: CosmosModel }[]): {
    merged: CosmosModel;
    conflicts: string[];
} {
    const containerMap = new Map<string, { container: CosmosContainer; domains: string[] }>();
    const conflicts: string[] = [];
    let sourceType: string | undefined;

    const allAccessPatterns = domainModels.flatMap(({ domainName, model }) =>
        (model.accessPatterns ?? []).map((pattern) => ({ ...pattern, name: `${domainName}: ${pattern.name}` })),
    );
    const allCrossPartitionQueries = domainModels.flatMap(({ domainName, model }) =>
        (model.crossPartitionQueries ?? []).map((query) => ({ ...query, name: `${domainName}: ${query.name}` })),
    );

    for (const { domainName, model } of domainModels) {
        if (model.sourceType && !sourceType) {
            sourceType = model.sourceType;
        }

        for (const container of model.containers) {
            const existing = containerMap.get(container.name);
            if (!existing) {
                containerMap.set(container.name, {
                    container: { ...container },
                    domains: [domainName],
                });
            } else {
                existing.domains.push(domainName);

                for (const entity of container.entities) {
                    const duplicate = existing.container.entities.find((candidate) => candidate.name === entity.name);
                    if (duplicate) {
                        conflicts.push(
                            `Container "${container.name}": entity "${entity.name}" exists in both ` +
                                `"${existing.domains[0]}" and "${domainName}" domains`,
                        );
                    } else {
                        existing.container.entities.push(entity);
                    }
                }

                const existingPKs = (existing.container.partitionKeys ?? []).map((key) => key.path).join(',');
                const newPKs = (container.partitionKeys ?? []).map((key) => key.path).join(',');
                if (existingPKs && newPKs && existingPKs !== newPKs) {
                    conflicts.push(
                        `Container "${container.name}": partition key mismatch — ` +
                            `"${existing.domains[0]}" uses [${existingPKs}] vs "${domainName}" uses [${newPKs}]`,
                    );
                }

                const incomingPolicy = container.fullTextPolicy;
                const existingPolicy = existing.container.fullTextPolicy;
                if (incomingPolicy && existingPolicy) {
                    if (incomingPolicy.defaultLanguage !== existingPolicy.defaultLanguage) {
                        conflicts.push(
                            `Container "${container.name}": full-text default language differs between domains`,
                        );
                    }
                    const fullTextPaths = new Map(
                        existingPolicy.fullTextPaths.map((entry) => [
                            entry.path,
                            {
                                ...entry,
                                language: entry.language ?? existingPolicy.defaultLanguage,
                            },
                        ]),
                    );
                    for (const entry of incomingPolicy.fullTextPaths) {
                        const language = entry.language ?? incomingPolicy.defaultLanguage;
                        const previous = fullTextPaths.get(entry.path);
                        if (previous && previous.language !== language) {
                            conflicts.push(
                                `Container "${container.name}": full-text language differs for path "${entry.path}"`,
                            );
                        } else if (!previous) {
                            fullTextPaths.set(entry.path, { ...entry, language });
                        }
                    }
                    existing.container.fullTextPolicy = {
                        defaultLanguage: existingPolicy.defaultLanguage,
                        fullTextPaths: [...fullTextPaths.values()],
                    };
                } else if (incomingPolicy) {
                    existing.container.fullTextPolicy = incomingPolicy;
                }

                if (container.indexingPolicy && existing.container.indexingPolicy) {
                    existing.container.indexingPolicy = mergeIndexingPolicies(
                        existing.container.indexingPolicy,
                        container.indexingPolicy,
                    );
                } else if (container.indexingPolicy) {
                    existing.container.indexingPolicy = container.indexingPolicy;
                }
            }
        }
    }

    const merged: CosmosModel = {
        version: 1,
        domain: 'all',
        sourceType,
        containers: Array.from(containerMap.values()).map((entry) => entry.container),
        accessPatterns: allAccessPatterns.length > 0 ? allAccessPatterns : undefined,
        crossPartitionQueries: allCrossPartitionQueries.length > 0 ? allCrossPartitionQueries : undefined,
    };

    return { merged, conflicts };
}

function mergeIndexingPolicies(first: IndexingPolicy, second: IndexingPolicy): IndexingPolicy {
    const unionPaths = (firstPaths: { path: string }[], secondPaths: { path: string }[]): { path: string }[] => {
        const paths = new Set(firstPaths.map((entry) => entry.path));
        const result = [...firstPaths];
        for (const entry of secondPaths) {
            if (!paths.has(entry.path)) {
                result.push(entry);
                paths.add(entry.path);
            }
        }
        return result;
    };

    return {
        indexingMode: first.indexingMode ?? second.indexingMode,
        automatic: first.automatic ?? second.automatic,
        includedPaths: unionPaths(first.includedPaths, second.includedPaths),
        excludedPaths: unionPaths(first.excludedPaths, second.excludedPaths),
        compositeIndexes: [...(first.compositeIndexes ?? []), ...(second.compositeIndexes ?? [])],
        fullTextIndexes: unionPaths(first.fullTextIndexes ?? [], second.fullTextIndexes ?? []),
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

export function normalizeParsedAccessPatterns(patterns: ParsedAccessPattern[]): ParsedAccessPattern[] {
    return patterns.map((pattern) => {
        const filterFields = (pattern as ParsedAccessPattern & { filterFields?: string | string[] }).filterFields;
        return {
            ...pattern,
            ...(Array.isArray(filterFields) ? { filterFields: filterFields.join(', ') } : {}),
        };
    });
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
