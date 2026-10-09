# DDL Interpretation

Choose and follow the interpretation procedure before preparing schema inputs.
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

Before invoking SQLGlot, identify the source dialect from application metadata and DDL
context and compare it with the pinned version's dialect registry or official SQLGlot
documentation. If the dialect is unsupported, warn and use model-only interpretation
regardless of how SQLGlot was selected. When host web access is available, the model
may research authoritative vendor documentation to understand quoting, qualification,
batching, types, constraints, and procedural syntax. Record URLs consulted and any
remaining uncertainty in the preflight summary. Research assists reasoning; it does
not turn model interpretation into source-engine validation.

If SQLGlot is unavailable or installation fails, inspect `decisionSource`. For an
`unattended-default`, warn and continue with model-only interpretation. For a current
explicit request or saved `interactive`/`explicit` SQLGlot selection, attempt installation
only when host policy permits, then abort if SQLGlot remains unavailable. Do not silently
downgrade an explicitly selected available dialect because setup failed.

For either automatic fallback, persist the effective choice as `method: "model"`, retain
the original `decisionSource`, and add `fallbackFrom: "sqlglot"` with
`fallbackReason: "unsupported-dialect" | "unavailable"`. Omit fallback fields for direct
choices. Report the warning before continuing, and record `parser.method: "model"` in the
source inventory. Do not silently label model output as SQLGlot output.

## Using SQLGlot

After the choice permits it, the agent determines how to call SQLGlot through its
ordinary host tools, consulting [its API documentation](https://sqlglot.com/sqlglot.html).
Use the source dialect explicitly, inspect the AST and diagnostics, and account for
every selected statement. Do not assume an opaque fallback node is a parsed object.
Do not transpile over supplied DDL, execute it, or silently discard unsupported syntax.
The agent may invoke the library directly; no persistent custom extraction script
or additional extraction-result file is required or shipped with the Skill.

The optional setup helper only manages the dependency, not parsing:

```bash
node <skill-root>/scripts/setup-ddl-parser.mjs --workspace <workspace>
node <skill-root>/scripts/setup-ddl-parser.mjs --workspace <workspace> --install
```

The first command is read-only. Run the second only when the persisted choice and
host permissions allow installation. It creates a dedicated environment under
`.cosmosdb-migration/.tools/` for Python 3.11+ and the version/hash-pinned pure-Python
wheel in `scripts/requirements-ddl.txt`. Use `--python <executable>` or the Windows
launcher to select an interpreter; `--wheel-dir <directory>` supports approved
offline wheels. It never changes application dependencies or global Python. A saved
model-only decision disables this helper. Validation and state inspection never
call it, and model-only work does not need Python at all. For an unattended default,
the helper returns a model fallback and warning when SQLGlot is unavailable or setup
fails; persist the returned fallback before continuing. For an explicit SQLGlot
selection, the same condition returns an abort result.

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

In both methods, selected DDL is immutable source truth. Source code may reveal
discrepancies but cannot override it. Inference is allowed only for an empty selected
DDL set, and inferred DDL receives the same chosen-method interpretation afterward.
