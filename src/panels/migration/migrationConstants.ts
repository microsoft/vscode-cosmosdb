/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Tunable constants for the Migration Assistant phases.
 *
 * Centralized here so the full tuning policy is visible in a single place and
 * duplicated literals across phase steps cannot drift out of sync.
 *
 * Low-level token/file limits that are not migration-specific live in
 * `src/utils/aiUtils.ts` (e.g. `CHARS_PER_TOKEN`, `MAX_FILE_TOKENS`).
 */

// ─── Agentic loop caps ──────────────────────────────────────────────

/**
 * Maximum number of tool-call rounds for the Phase 2 assessment agentic loop.
 *
 * Each round consists of one model turn plus any tool invocations it requests.
 * A hard cap prevents runaway loops where the model keeps requesting tools
 * without converging on a final answer.
 */
export const MAX_TOOL_ROUNDS = 100;

/**
 * Maximum number of tool-call rounds for the Phase 3 schema-conversion
 * agentic loop. Schema conversion legitimately needs more rounds than
 * assessment because it makes multiple best-practice rule lookups per
 * container design.
 */
export const MAX_SCHEMA_TOOL_ROUNDS = 100;

// ─── Token estimation overheads ─────────────────────────────────────

/**
 * Per-round overhead constant (tokens) for the Phase 1 discovery agentic
 * loop: accounts for assistant/tool metadata accumulated across rounds
 * (~100–200 tokens/round × ~30 rounds).
 */
export const AGENTIC_OVERHEAD_TOKENS = 5000;

/**
 * Conservative fixed overhead (tokens) for the Phase 2 assessment prompt
 * template's static instructions (i.e. everything that is not the domain
 * markdown or the best-practices content).
 */
export const PROMPT_OVERHEAD_TOKENS = 3_000;

/**
 * Per-domain token budget used by Phase 2 assessment to decide whether a
 * domain is "oversized" and must be split before running the full prompt.
 */
export const ASSESSMENT_TOKEN_THRESHOLD = 150_000;

// ─── Context-gathering caps ─────────────────────────────────────────

/**
 * Maximum number of bytes/characters read from a single manifest or config
 * file when building the workspace context preview in Phase 1 discovery.
 */
export const MANIFEST_PREVIEW_CHARS = 3_000;

/**
 * Maximum number of schema files included in the Phase 1 discovery
 * chat-discovery preview prompt.
 */
export const SCHEMA_PREVIEW_FILE_LIMIT = 10;

/**
 * Maximum number of characters read from each schema file included in the
 * Phase 1 discovery chat-discovery preview prompt.
 */
export const SCHEMA_PREVIEW_CHARS_PER_FILE = 5_000;
