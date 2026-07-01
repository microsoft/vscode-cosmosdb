/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Deterministic mock of the migration AI layer for Playwright e2e tests.
 *
 * Why this exists
 * ---------------
 * The Migration Assistant drives every phase (discovery → assessment → schema
 * conversion → provisioning) through Copilot language models. A real VS Code
 * launched by Playwright has no Copilot signed in, so the phase buttons would
 * stay disabled and no AI flow could be exercised end-to-end.
 *
 * This module supplies a fake `vscode.LanguageModelChat` whose `sendRequest`
 * inspects the rendered prompt and returns a canned, schema-valid response for
 * each distinct migration AI call. Because the migration helpers route ALL
 * model access through {@link getSelectedModel} (extension side), swapping in
 * this mock makes the full pipeline run offline and deterministically.
 *
 * Visibility / safety
 * -------------------
 *  - Active ONLY when both `COSMOSDB_E2E_TEST === '1'` and
 *    `COSMOSDB_E2E_MIGRATION_AI_MOCK === '1'` (set by the Playwright fixture in
 *    `test/e2e/fixtures/vscode.ts`).
 *  - Production users never set these env vars, so the mock is never wired in.
 *
 * Routing
 * -------
 * The run helpers (`aiHelpers.ts`) call `setMockRoute(model, stepId)` on this
 * mock immediately before every `model.sendRequest`, passing the stable
 * kebab-case step id (e.g. `step1-analysis`). The mock routes purely on that
 * id (see {@link routeMockResponse}) — no fuzzy prompt-text matching — so
 * rewording a prompt never changes which fixture is returned. An unmapped id
 * throws, surfacing prompt/test drift loudly instead of silently degrading.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import type * as vscode from 'vscode';
import { createMockLanguageModel } from '../../../utils/languageModelMockUtils';

const E2E_TEST_ENV_KEY = 'COSMOSDB_E2E_TEST';
/** When set, every mock request appends `{route, promptText}` to capture.jsonl. */
const CAPTURE_DIR_ENV_KEY = 'COSMOSDB_E2E_MIGRATION_CAPTURE_DIR';
const MIGRATION_AI_MOCK_ENV_KEY = 'COSMOSDB_E2E_MIGRATION_AI_MOCK';

/** Stable identity for the mock model, surfaced in the webview model dropdown. */
const MOCK_MODEL_ID = 'e2e-mock-migration-model';
const MOCK_MODEL_NAME = 'E2E Mock Model';

/**
 * `true` when the migration AI mock should be wired in. Requires the master
 * e2e flag as well so the mock can never leak into a normal session.
 */
export function isMigrationAiMockEnabled(): boolean {
    return process.env[E2E_TEST_ENV_KEY] === '1' && process.env[MIGRATION_AI_MOCK_ENV_KEY] === '1';
}

// ─── Canned fixtures ────────────────────────────────────────────────

const MOCK_DOMAIN = 'SalesDomain';

/** A small but structurally complete CosmosModel reused across Phase 3 calls. */
const MOCK_COSMOS_MODEL = {
    version: 1,
    domain: MOCK_DOMAIN,
    sourceType: 'SQL Server',
    capacityMode: 'serverless',
    containers: [
        {
            name: 'orders',
            partitionKeys: [{ path: '/customerId' }],
            entities: [
                {
                    name: 'Order',
                    docType: 'order',
                    sourceTable: 'Orders',
                    idTemplate: 'order-{OrderID}',
                    attributes: [
                        {
                            target: 'id',
                            source: { table: 'Orders', column: 'OrderID', type: 'int' },
                            type: 'string',
                            isId: true,
                        },
                        {
                            target: 'customerId',
                            source: { table: 'Orders', column: 'CustomerID', type: 'int' },
                            type: 'string',
                            isPartitionKey: true,
                        },
                        {
                            target: 'total',
                            source: { table: 'Orders', column: 'Total', type: 'decimal' },
                            type: 'number',
                        },
                    ],
                    relationships: [],
                },
            ],
            indexingPolicy: {
                indexingMode: 'consistent',
                automatic: true,
                includedPaths: [{ path: '/*' }],
                excludedPaths: [{ path: '/"_etag"/?' }],
            },
        },
    ],
};

const COSMOS_MODEL_JSON = JSON.stringify(MOCK_COSMOS_MODEL, null, 2);

/** A `{ analysis, updatedModel }` envelope for Phase 3 thorough sub-steps. */
const SCHEMA_STEP_RESULT_JSON = JSON.stringify(
    {
        analysis: '## Analysis\n\nMock analysis for the e2e schema-conversion sub-step.',
        updatedModel: MOCK_COSMOS_MODEL,
    },
    null,
    2,
);

/** Fast-conversion / final-summary sentinel format: JSON then `===SUMMARY===` then markdown. */
const FAST_CONVERSION_RESPONSE = `${COSMOS_MODEL_JSON}
===SUMMARY===
# Schema Conversion Summary

## Container Summary
- **orders** — partition key \`/customerId\`, single entity \`Order\`.

## Example JSON Documents
\`\`\`json
{ "id": "order-1", "customerId": "c1", "total": 100, "docType": "order" }
\`\`\`
`;

const APPLICATION_DETAILS_JSON = JSON.stringify({
    projectName: 'Contoso Sales',
    projectType: 'Web API',
    language: 'C#',
    frameworks: ['ASP.NET Core', 'Entity Framework'],
    databaseType: 'SQL Server',
    databaseAccess: 'Entity Framework',
});

const ACCESS_PATTERN_EXTRACTION_JSON = JSON.stringify({
    accessPatterns: [
        {
            name: 'R001-GetOrdersByCustomer',
            type: 'read',
            tables: ['Orders'],
            frequency: 'high',
            codeReferences: ['OrderRepository.cs'],
            filterFields: ['CustomerID'],
            singleOrBatch: 'batch',
        },
    ],
});

const DOMAIN_IDENTIFICATION_JSON = JSON.stringify({
    domains: [
        {
            name: MOCK_DOMAIN,
            description: 'Customer orders and order line items.',
            tables: ['Orders', 'OrderDetails'],
            rationale: 'These tables form a cohesive order-management bounded context.',
            aggregateRoot: 'Orders',
        },
    ],
});

const SPLIT_DOMAIN_JSON = JSON.stringify({
    subDomains: [
        {
            name: MOCK_DOMAIN,
            description: 'Customer orders.',
            tables: ['Orders', 'OrderDetails'],
            rationale: 'Single cohesive sub-domain.',
            aggregateRoot: 'Orders',
        },
    ],
});

const CROSS_DOMAIN_JSON = JSON.stringify({
    crossDomainDependencies: [],
    domainRecommendations: {},
    summary: 'No significant cross-domain dependencies detected in the e2e mock.',
});

const DOMAIN_MAPPING_RESPONSE =
    'After investigating the workspace, the domain is referenced in application code. ' +
    '{ "isMapped": true, "evidence": "OrderRepository.cs references the Orders table." }';

const ASSESSMENT_SUMMARY_MARKDOWN = `# Domain Assessment Summary

## Domains
### ${MOCK_DOMAIN}
- Tables: Orders, OrderDetails
- Mapped in code: yes
`;

const DISCOVERY_REPORT_MARKDOWN = `# Discovery Report

## Schema Overview
| Schema | Tables |
| ------ | ------ |
| Sales  | Orders, OrderDetails |

## Read Patterns
### R001-GetOrdersByCustomer
Retrieve all orders for a given customer.

## Write Patterns
### W001-InsertOrder
Insert a new order row.
`;

const ACCESS_PATTERNS_MARKDOWN = `## Access Pattern Mapping

### R001-GetOrdersByCustomer
- Target container: \`orders\`
- Operation: point-read by partition key \`/customerId\`
`;

const CROSS_PARTITION_MARKDOWN = `## Cross-Partition Queries

No cross-partition queries are required for this domain in the e2e mock.
`;

const DOMAIN_SUMMARY_MARKDOWN = `## Container Summary
- **orders** — partition key \`/customerId\`.

## Example JSON Documents
\`\`\`json
{ "id": "order-1", "customerId": "c1", "total": 100, "docType": "order" }
\`\`\`
`;

const SAMPLE_DATA_JSON = JSON.stringify({
    sampleData: [
        {
            containerName: 'orders',
            items: [
                { id: 'order-1', customerId: 'c1', total: 100, docType: 'order' },
                { id: 'order-2', customerId: 'c2', total: 250, docType: 'order' },
            ],
        },
    ],
});

// ─── Routing ────────────────────────────────────────────────────────

/**
 * Exact `stepName` → canned response map. Keys are the stable kebab-case step
 * ids produced by `createMkDebug`/`sanitizeStepName` and threaded to the mock
 * via `setMockRoute` right before each request.
 */
const ROUTE_MAP: Record<string, string> = {
    // Phase 1: Discovery
    'step1-analysis': APPLICATION_DETAILS_JSON,
    'step2-discovery': DISCOVERY_REPORT_MARKDOWN,
    // Phase 2: Assessment
    'step1-access-pattern-extraction': ACCESS_PATTERN_EXTRACTION_JSON,
    'step2-domain-identification': DOMAIN_IDENTIFICATION_JSON,
    'step5-cross-domain': CROSS_DOMAIN_JSON,
    summary: ASSESSMENT_SUMMARY_MARKDOWN,
    // Phase 3: Schema Conversion
    'step1-container-design': COSMOS_MODEL_JSON,
    'step2-partition-key': SCHEMA_STEP_RESULT_JSON,
    'step3-embedding': SCHEMA_STEP_RESULT_JSON,
    'step4-access-patterns': ACCESS_PATTERNS_MARKDOWN,
    'step5-cross-partition': CROSS_PARTITION_MARKDOWN,
    'step6-indexing': SCHEMA_STEP_RESULT_JSON,
    'step7-summary': DOMAIN_SUMMARY_MARKDOWN,
    'fast-conversion': FAST_CONVERSION_RESPONSE,
    'step8-final-summary': FAST_CONVERSION_RESPONSE,
    // Phase 4: Provisioning
    'sample-data-generation': SAMPLE_DATA_JSON,
};

/**
 * Prefix-matched routes for steps whose id embeds a dynamic domain name
 * (e.g. `step4-split-domain-salesdomain`, `step6-domain-mapping-salesdomain`).
 */
const ROUTE_PREFIXES: readonly { readonly prefix: string; readonly response: string }[] = [
    { prefix: 'step4-split-domain-', response: SPLIT_DOMAIN_JSON },
    { prefix: 'step6-domain-mapping-', response: DOMAIN_MAPPING_RESPONSE },
];

/**
 * Maps a stable step id to its deterministic canned response. Throws on an
 * unknown id so prompt/test drift surfaces loudly instead of silently falling
 * back to an empty object.
 */
function routeMockResponse(route: string | undefined): string {
    if (route !== undefined) {
        const exact = ROUTE_MAP[route];
        if (exact !== undefined) {
            return exact;
        }
        for (const { prefix, response } of ROUTE_PREFIXES) {
            if (route.startsWith(prefix)) {
                return response;
            }
        }
    }

    throw new Error(`[e2eMigrationAiMock] No canned response mapped for route id "${route ?? '<undefined>'}".`);
}

/**
 * Builds a fake {@link vscode.LanguageModelChat} that returns deterministic
 * canned responses for every migration AI call. Tool calls are never emitted,
 * so every agentic loop completes naturally in its first round.
 */
export function createMockMigrationModel(): vscode.LanguageModelChat {
    return createMockLanguageModel({
        id: MOCK_MODEL_ID,
        name: MOCK_MODEL_NAME,
        resolveResponse: async ({ route, promptText, token }): Promise<string> => {
            capturePrompt(route, promptText);
            const control = readControl();
            if (route && control.failRoutes?.includes(route)) {
                throw new Error(`[e2eMigrationAiMock] Injected failure for route "${route}".`);
            }
            if (control.delayMs && control.delayMs > 0) {
                await delay(control.delayMs, token);
            }
            return routeMockResponse(route);
        },
    });
}

/** Test-tunable behavior, read fresh per request from `control.json`. */
interface MockControl {
    delayMs?: number;
    failRoutes?: string[];
}

function readControl(): MockControl {
    const dir = process.env[CAPTURE_DIR_ENV_KEY];
    if (!dir) {
        return {};
    }
    try {
        return JSON.parse(readFileSync(path.join(dir, 'control.json'), 'utf-8')) as MockControl;
    } catch {
        return {};
    }
}

/** Cancellable sleep so a phase's Cancel button can abort mid-request. */
function delay(ms: number, token?: vscode.CancellationToken): Promise<void> {
    return new Promise((resolve) => {
        const timer = setTimeout(resolve, ms);
        token?.onCancellationRequested(() => {
            clearTimeout(timer);
            resolve();
        });
    });
}

/**
 * Best-effort, test-only sink: appends each request's route + flattened prompt
 * text to `capture.jsonl` in {@link CAPTURE_DIR_ENV_KEY}. Lets e2e tests assert
 * that user-entered phase instructions actually reach the model prompt.
 */
function capturePrompt(route: string | undefined, promptText: string): void {
    const dir = process.env[CAPTURE_DIR_ENV_KEY];
    if (!dir) {
        return;
    }
    try {
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }
        appendFileSync(path.join(dir, 'capture.jsonl'), JSON.stringify({ route: route ?? null, promptText }) + '\n');
    } catch {
        // Capture is diagnostic-only; never let it break the mock.
    }
}
