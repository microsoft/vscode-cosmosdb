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
context and compare it with the selected release's dialect registry or official SQLGlot
documentation. If the dialect is unsupported, warn and use model-only interpretation
regardless of how SQLGlot was selected. When host web access is available, the model
may research authoritative vendor documentation to understand quoting, qualification,
batching, types, constraints, and procedural syntax. Record URLs consulted and any
remaining uncertainty in the preflight summary. Research assists reasoning; it does
not turn model interpretation into source-engine validation.

If the latest release is unavailable or its provenance is in doubt, consider the
[tested fallback release](#tested-fallback-release) under the same host permissions
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

## Using SQLGlot

After the choice permits it, the agent determines how to call SQLGlot through its
ordinary host tools, consulting [its API documentation](https://sqlglot.com/sqlglot.html).
Use the source dialect explicitly, inspect the AST and diagnostics, and account for
every selected statement. Do not assume an opaque fallback node is a parsed object.
Do not transpile over supplied DDL, execute it, or silently discard unsupported syntax.
The agent may invoke the library directly; no persistent custom extraction script
or additional extraction-result file is required or shipped with the Skill.

The agent manages dependency discovery, setup, and invocation through ordinary host
tools. Use the latest available SQLGlot release; the Skill does not pin a release or
prescribe an interpreter path. Determine its Python requirements and supported API
from current package metadata and documentation. If the host permits only an offline
package source, use the latest release available there and disclose that constraint.

Select or create an isolated Python environment without modifying application
dependencies or global Python. Apply the host's execution approvals, sandbox
restrictions, and network permissions to dependency checks, installation, and parsing.
A version or import check executes code; selecting SQLGlot does not bypass those
safeguards. Do not infer permission to execute an environment from its location or
from a saved parsing choice alone.

Confirm the actual version used and record it in the source inventory's
`parser.version`, with `parser.name: "sqlglot"` and `parser.method: "sqlglot"`.
Record the selected source dialect and observed parsing errors as required by the
source inventory contract. Validation and state inspection do not install or invoke
SQLGlot. Model-only work does not need Python at all.

If no permitted environment can run SQLGlot, follow the unavailable-parser policy
above: an unattended default warns and falls back to model-only interpretation;
an explicit selection aborts unless the user changes the choice. Persist automatic
fallback metadata before continuing. The Skill bundles no setup or readiness wrapper.

### Tested Fallback Release

Recommended fallback: [SQLGlot 30.22.0](https://pypi.org/project/sqlglot/30.22.0/),
the current PyPI release verified on **2026-10-09**. The
[opt-in DDL evaluation](../../tests/sqlglot-evaluation.test.mjs) passed with Python
3.14.8 for representative T-SQL, PostgreSQL, MySQL, Oracle, and SQLite inputs.
The release metadata requires Python >=3.9. This is an advisory compatibility
baseline, not a default version pin or a security audit; the checks do not establish
support for every source construct or source-engine execution validity.

Prefer the latest available release normally. Consider this fallback when the latest
release is unavailable or an upstream takeover or compromise is suspected. Honor
explicit user version constraints and model-only choices. Report the reason for using
the fallback and its artifact source in the preflight summary, and record the actual
version in `parser.version`. Using an older SQLGlot release is not a model-only fallback.

The evaluated pure-Python wheel was published on 2026-10-09:

- Artifact: `sqlglot-30.22.0-py3-none-any.whl`
- SHA-256: `90aa461490fcd95d14ec3842a97506ae20f6d3e9313307ad31be793d479cca65`
- [Release metadata](https://pypi.org/pypi/sqlglot/30.22.0/json)

If upstream provenance is in doubt, use an independently trusted cached or mirrored
copy whose SHA-256 matches the recorded digest. Do not fetch executable code or
replacement digests from a suspected compromised source. A version string alone does
not establish trust, and this recommendation does not override relevant security
advisories or the host's execution policy. If no trusted, permitted artifact is
available, follow the existing unavailable-parser fallback or abort policy above.

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
