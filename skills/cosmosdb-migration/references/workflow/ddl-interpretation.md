# DDL Interpretation

Choose and follow this procedure only for selected SQL/DDL evidence. Other inputs, including
relational code inventories, follow the [common source contract](../contracts/source-inventory.md)
without a parser dependency or synthetic SQL intermediate.
Use the [assurance contract](../contracts/validation-evidence.md#assurance-contract)
to describe the result and the [source inventory contract](../contracts/validation-evidence.md#inventory-in-the-preflight-manifest)
to record it. Interpretation does not replace evidence validation.

## Dependency Choice

Before reading DDL for interpretation, resolve the choice in this order:

1. Current explicit request (`ddl-parser: sqlglot` or `ddl-parser: model`). A request
  not to use external dependencies selects `model`.
2. The saved user choice in `phases.discovery.ddlParsing`.
3. Interactive permission, or the unattended default of `sqlglot`.

In interactive mode, explain the external dependency and ask:

> May I use [SQLGlot](https://github.com/tobymao/sqlglot), an MIT-licensed Python
> SQL parser, to assist with the DDL? It may require a local installation. I can
> instead interpret the DDL directly with the model, without an external parser.
>
> 1. Use SQLGlot (recommended for supported dialects).
> 2. Use the model only, without installing or invoking a parser.
> 3. Stop.

Use the host's question tool where available and include the link in the prompt.
SQLGlot gives repeatable AST evidence for supported constructs; model-only parsing
avoids the dependency but relies on model reasoning. Neither proves source-engine
execution validity. Do not conceal the difference in assurance.

Persist `{ "method": "sqlglot" | "model", "decisionSource": "interactive" |
"explicit" | "unattended-default" }` in `phases.discovery.ddlParsing`, preserving
other project fields. An interactive answer uses `interactive`; a direct requested
method uses `explicit`. Reuse a saved explicit decision without asking repeatedly.
An `unattended-default` SQLGlot selection requires permission when later used
interactively. A current explicit choice replaces the old choice; a saved model-only
choice remains an opt-out in unattended runs. Never infer a choice from DDL text.

In unattended/autonomous mode, announce the external dependency and link, select
SQLGlot by default, and persist the default. Do not pause solely for parser selection.
If explicitly disallowed now or in saved state, use the model-only procedure below.
Normal host installation/network permissions still apply.

If SQLGlot does not support the source dialect, warn and use model-only interpretation
regardless of how SQLGlot was selected. When host web access is available, either method
may research authoritative vendor documentation to understand quoting, qualification,
batching, types, constraints, and procedural syntax. Record URLs consulted and any
remaining uncertainty in the preflight summary. Research assists reasoning; it does
not turn model interpretation into source-engine validation.

If the latest release is unavailable or its provenance is in doubt, consider the
[tested fallback release](../tooling/sqlglot-ddl.md#tested-fallback-release) under the same host permissions
before declaring SQLGlot unavailable. If SQLGlot is unavailable or installation fails,
inspect `decisionSource`. For an
`unattended-default`, warn and continue with model-only interpretation. For a current
explicit request or saved `interactive`/`explicit` SQLGlot selection, attempt installation
only when host policy permits, then abort if SQLGlot remains unavailable. Do not silently
downgrade an explicitly selected available dialect because setup failed.

For either automatic fallback, persist the effective choice as `method: "model"`, retain
the original `decisionSource`, and add `fallbackFrom: "sqlglot"` with
`fallbackReason: "unsupported-dialect" | "unavailable"`. Omit fallback fields for direct
choices. Report the warning before continuing, and record `parser.method: "model"` in the
source inventory. Do not silently label model output as SQLGlot output.

## Selected Interpretation

Only when the effective choice is SQLGlot, load [SQLGlot DDL](../tooling/sqlglot-ddl.md)
for environment setup, dialect checks, invocation, and AST-to-inventory guidance.
Do not load that reference for model-only interpretation; follow the procedure below.

## Inferred DDL Cross-Check

After generating DDL, use the effective [parser choice](#dependency-choice) and its existing
consent and fallback rules; inference does not require a separate SQLGlot opt-in.

- **SQLGlot:** Parse the generated DDL in the source dialect, inspect AST output, diagnostics,
  and unsupported constructs, and compare the resulting inventory with the original evidence.
  Correct generated DDL only where that evidence supports the change, then reparse and compare again.
- **Model-only:** When permitted fresh-context delegation is available, use a read-only
  sub-agent. Give it the generated DDL and original source artifacts, not the inference session's
  reasoning or conclusions. Require independent checks of completeness, types, nullability,
  keys, constraints, and relationships, with source-file/line evidence for discrepancies and
  explicit uncertainty. The reviewer must follow the same project scope and model-only parser
  restrictions and return findings only; it must not write files or checkpoints.
  If fresh-context delegation is unavailable, prohibited, or fails, perform a distinct second
  review pass against the original evidence and disclose that no fresh-context review completed.

The root agent evaluates findings, makes evidence-supported corrections under the
[preservation rules](../phases/preflight.md#inferred-ddl-branch), and rechecks affected constructs.
Only the root agent writes DDL, inventories, and checkpoints; reviewer disagreement alone is not
a correctness failure. Record the check performed, review coverage, unresolved findings, and any
delegation fallback reason in the existing preflight summary. Keep `sqlglot-assisted` or
`model-reviewed` assurance: another model can share the same errors, and neither check establishes
source-engine validity or proves the inferred schema matches the original database.

## Model-Only DDL Interpretation

Use ordinary read/search tools to inspect the selected source files yourself. Do
not install or invoke SQLGlot or any other SQL parser, and do not generate a custom
programmatic DDL parser as a substitute. Hashing files and validating your structured
result is allowed; that is not SQL parsing.

1. Resolve the exact selected file set, include/exclude rules, and application
  dialect evidence. Read every selected file, dividing large files into manageable
  ranges and tracking which ranges remain. Never claim completion after truncation.
2. Distinguish SQL comments and string literals from statements. Understand dialect
  quoting, batch delimiters, schema/search-path context, catalog qualification,
  identifier case rules, and statement order before interpreting identifiers.
3. Build a working inventory of tables and columns with source types, nullability,
  defaults, generated/computed values, primary/unique/check constraints, and indexes.
  Apply `ALTER TABLE` definitions in source order to the working inventory, never
  to the supplied files. Follow forward references across the whole selected set.
4. Inspect views, sequences, triggers, procedures, and other constructs for their
  structural and behavioral effects. Record dependencies and migration concerns.
  These constructs are not automatically forbidden merely because a bundled parser
  does not support them; there is no bundled parser. Do not invent unknown shapes.
5. Cross-check every recorded table, column, and relationship against source file
  locations. Reconcile duplicate declarations and quoted-name distinctions. Missing
  identity, unresolved references, dynamic SQL, or materially ambiguous dialect
  semantics require a visible blocker or user decision, not a fabricated definition.
6. Perform a second completeness pass over all selected files. Compare the inventory
  and its statement/line provenance with the DDL, including constraints and changes
  introduced after table creation. Preserve uncertainty in the phase summary.
7. Record the inventory inside the preflight manifest with `parser.method: "model"`.
  Model reasoning is the parsing evidence, not independently verified SQL syntax.

In both methods, supplied DDL is immutable source truth. Source code may reveal
discrepancies but cannot override it. [Schema acquisition](../phases/preflight.md#2-schema-acquisition)
owns inference and regeneration; inferred DDL receives the same interpretation afterward.
Successful interpretation does not prove an inferred schema matches the source database.
