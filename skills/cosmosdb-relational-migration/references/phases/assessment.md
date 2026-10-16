# Domain Assessment (`assessment`)

`assessment` decomposes the authoritative source model into business domains and
records cross-domain migration concerns. It does not choose final containers or
partition keys.

## Expected Output Artifacts

Required:

- `phases/2-assessment/assessment-summary.md` and `assessment-manifest.json`.
- One `phases/2-assessment/domains/<DomainName>.md` for every domain listed in
   `phases.assessment.domains`, with a sibling `<DomainName>.manifest.json`.
- `project.json` with non-empty assessment domain metadata and
   `phases.assessment.status: "complete"`.

## Prerequisites

- `preflight` readiness passes.
- `phases.discovery.status` is `complete`.
- `phases/1-discovery/discovery-report.md` and `discovery-manifest.json` exist and cover all DDL entities.
- `phases.assessment.assessmentInstructions`, when present.

## Procedure

1. Initialize or set `phases.assessment.status` to `in-progress` and increment
   the assessment run count.
2. Parse all discovery access patterns into structured working data. Preserve
   names, entities, TPS, filter fields, batch scope, examples, and references.
3. Build a dependency graph from authoritative DDL.
4. Identify bounded contexts using the Domain Identification Heuristics below.
5. Assign every non-excluded table to exactly one domain. Validate this
   programmatically; do not rely on the model's assertion.
6. Associate access patterns by table overlap and record patterns spanning domains.
7. Split a domain only for business cohesion or agent context limits. A domain is
   not a Cosmos DB logical partition; do not split it solely because of service
   logical-partition limits.
8. Analyze cross-domain dependencies using dynamically resolved guidance for
   references, duplicated data, materialized views, change feed, and transaction
   limits.
9. Check whether each domain has confirmed application mappings.
10. Estimate each finalized domain's schema-conversion context and split domains
      whose estimates exceed the context policy.
11. Write domain files and the assessment summary.

## Domain Identification Heuristics

Reuse discovery evidence; inspect source only to resolve gaps. Trace entry points
through services, repositories/DAOs, queries, and tables, including jobs, message
consumers, CLI tools, stored procedures, and other applications where evidence is
available. Record unexamined access paths as uncertainty, not absence of use.

Before declaring evidence unavailable, check supplied artifacts for derivable
sample statistics such as child counts per parent. Record their provenance and
limitations; sample observations do not establish production guarantees.

- **Primary evidence:** Business purpose, authoritative ownership, lifecycle, and
   consistency invariants take precedence over read convenience. Schemas, names,
   and structural similarity are supporting clues, not a domain-count target.
- **Coupling:** Assess actual transactions, coordinated writes, FK/constraint
   semantics, and shared workflows. Preserve required atomicity across proposed
   boundaries; a source transaction is not automatically one domain or container.
   An FK untraversed in code can still enforce a material invariant.
- **Read cohesion:** Identify cross-boundary queries by ownership and semantics,
   not table-join counts. Frequent reporting joins do not alone justify merging
   independent domains. Give shared reference tables one authoritative owner and
   record their consumers rather than grouping every connected table together.
- **Confidence:** Separate signal importance from evidence quality; distinguish
   observed, code-evidenced, and inferred behavior. Missing access evidence is not
   a weak relationship or permission to deprecate/exclude a table. Retain its owner
   and record no observed access and mapping uncertainty explicitly.
- **Aggregates:** A domain may contain several aggregates. Use the existing
   `aggregateRoot` field for a representative entry point and describe other
   aggregates in its summary; do not imply domain-wide transactional scope.
- **Context splits:** Treat budget-driven subdivisions as analysis units, not
   evidence of business independence. Record their relationship to the original
   domain and preserve shared invariants and cross-subdivision dependencies.

For each proposed boundary, record the strongest evidence with source links,
counterevidence, uncertainty, and why a plausible alternative was rejected in the
existing domain summary. Use qualitative rationale, not arbitrary numeric scores.
Defer embedding, container placement, and partition-key decisions to schema
conversion; resolve any preliminary Cosmos DB recommendations dynamically from
current peer guidance without requiring specific rules.

## Schema-Conversion Token Estimate

Estimate the context required to convert each domain after adding cross-domain
dependencies and recommendations. This value estimates one schema-conversion
context, not billing cost or total multi-turn agent usage.

Estimate the full known working set, not only the domain Markdown. Include:

- The preliminary domain document with `## Estimated Tokens:` normalized to `0`.
- Shared migration Skill instructions and phase references that will remain in context.
- The peer Skill index and every unique model-selected rule body.
- Shared root registry, discovery, and cross-domain evidence.
- Domain-specific source or evidence files that schema conversion must load.
- One bounded validator or tool result. The script defaults this allowance to 16 KiB.

Count each canonical shared path or selected rule once. A shared input still contributes
to each domain's fit calculation because it occupies that domain's working context, but
it is read and measured only once by the batch command.

When the host exposes the selected model's tokenizer and context window, use that
tokenizer over the same working set. Otherwise use the script's conservative
three-characters-per-token fallback. Invoke every finalized domain in one batch:

```bash
node <skill-root>/scripts/estimate-domain-tokens.mjs \
   --domain <DomainName>=<domain.md> \
   [--domain <DomainName>=<domain.md>]... \
   [--domain-input <DomainName>=<source-or-evidence-path>]... \
   --shared <skill-or-shared-evidence-path> \
   [--shared <skill-or-shared-evidence-path>]... \
   --rule <selected-rule-path> \
   [--rule <selected-rule-path>]... \
   [--context-window <tokens>] \
   [--output-reserve <tokens>] \
   [--safety-margin <tokens>]
```

With a known context window, the default output reserve is 20% and the safety margin
is 10%, leaving at most 70% for known inputs. Override either reserve only with host or
model-specific evidence. Split a domain only when its `budgetStatus` is `exceeds` and
`splitRequired` is `true`. Preserve the original table set across coherent aggregate
or relationship boundaries, then re-estimate every finalized child.

Without a known context window, the command reports `budgetStatus: "unknown"` and
`splitRequired: null`. Do not infer a fixed threshold or split solely from that result;
use business cohesion, explicit host limits, or an observed context failure instead.

Persist each domain's `estimatedInputTokens` integer as the
`estimatedTokens` project field. Record the estimator, context window, reserves,
budget status, and selected working-set categories in the assessment summary. The
fallback is an estimate, not proof that a host invocation will fit. Output is bounded
and paginated; use `--offset <nextOffset>` only when another domain page is needed.

## Domain Files

Write one stable PascalCase Markdown filename per domain under
`phases/2-assessment/domains/`. Reject separators, traversal, collisions, and
case-insensitive duplicates.

Each file contains:

- Domain purpose and rationale.
- Aggregate root.
- Authoritative table list.
- Assigned read and write patterns with source links.
- Cross-domain dependencies and proposed handling.
- Preliminary migration recommendations and applied rule provenance.
- Estimated context size for `schema-conversion`.

## Summary and Checkpoint

Use the summary and per-domain evidence manifests defined in
[validation-evidence.md](../contracts/validation-evidence.md). Bind them to the current source
inventory and checkpoint domains, and record valid cross-domain edges and strategies.

Write `phases/2-assessment/assessment-summary.md` containing the complete domain
inventory, table totals, cross-domain edges and strategies, complexity, warnings,
and relative links. After finalizing all phase artifacts and checkpoint domains,
record `project.json#freshness.assessment` through the freshness helper, including
every consulted workspace evidence file.

Persist `phases.assessment.domains` with name, tables, cross-domain dependencies,
estimated tokens, and mapping status. Persist parsed access patterns and
`completedAt` according to the version 1 format.

Use the exact domain and parsed-access-pattern property types in
[project-state-and-artifacts.md](../contracts/project-state-and-artifacts.md); phase validation and subsequent analysis
use these structured checkpoint values.

Before completion, verify:

- Every non-excluded table appears exactly once.
- Every domain file exists and matches checkpoint metadata.
- Cross-domain edges reference existing domains and tables.
- Split domains collectively preserve the parent table set.
- Warnings and unresolved evidence are retained.

Only then set assessment status to `complete`.

On resume, derive expected domain paths from project metadata. A missing summary
or domain file makes `assessment` incomplete and requires rerun or manual repair.
