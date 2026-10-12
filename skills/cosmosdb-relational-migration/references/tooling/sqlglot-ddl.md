# SQLGlot DDL

Read this reference only after [DDL interpretation](../workflow/ddl-interpretation.md)
selects SQLGlot. Model-only interpretation does not need this reference or Python.

## Setup and Dialect

The agent manages dependency discovery, setup, and invocation through ordinary host
tools. Use the latest available SQLGlot release; the Skill does not pin a release or
prescribe an interpreter path. Determine its Python requirements from current package
metadata. If the host permits only an offline package source, use the latest release
available there and disclose that constraint.

Select or create an isolated Python environment without modifying application
dependencies or global Python. Apply the host's execution approvals, sandbox
restrictions, and network permissions to dependency checks, installation, and parsing.
A version or import check executes code; selecting SQLGlot does not bypass those
safeguards. Do not infer permission to execute an environment from its location or
from a saved parsing choice alone.

Before invoking SQLGlot, identify the source dialect from application metadata and DDL
context. Common `read` values are SQL Server/T-SQL: `tsql`, PostgreSQL: `postgres`,
MySQL: `mysql`, Oracle: `oracle`, and SQLite: `sqlite`. The invocation below checks
the installed release with `Dialect.get_or_raise(dialect)`. An unknown dialect raises
`ValueError`; return to the shared unsupported-dialect policy rather than guessing a
similar dialect or using SQLGlot's default dialect. Registry membership does not prove
support for every construct in that dialect.

When installation is needed and permitted, a typical sequence is
`<base-python> -m venv <isolated-env>` followed by
`<env-python> -m pip install --upgrade sqlglot`. Use the environment's interpreter
explicitly (`<isolated-env>/bin/python` on POSIX or
`<isolated-env>\Scripts\python.exe` on Windows). Respect the host's package source;
do not change feeds or install global packages to make an example work.

Confirm the actual version used and record it in the source inventory's
`parser.version`, with `parser.name: "sqlglot"` and `parser.method: "sqlglot"`.
Record the selected source dialect and observed parsing errors as required by the
[source inventory contract](../contracts/validation-evidence.md#inventory-in-the-preflight-manifest).
Validation and state inspection do not install or invoke SQLGlot.

If no permitted environment can run SQLGlot, follow the
[unavailable-parser policy](../workflow/ddl-interpretation.md#dependency-choice):
an unattended default warns and falls back to model-only interpretation; an explicit
selection aborts unless the user changes the choice. Persist automatic fallback
metadata before continuing. The Skill bundles no setup or readiness wrapper.

## Invocation

Use this recipe for ordinary supported DDL without first consulting external API
documentation. For unfamiliar syntax or a changed API, inspect the installed library
or consult [SQLGlot's API documentation](https://sqlglot.com/sqlglot.html) and record
material limitations. The examples are an inspection aid, not a complete extractor.
Do not transpile over supplied DDL, execute it, or silently discard unsupported syntax.

Run the following Python inline through the host's execution tool, for example
`<env-python> -I -c '<code below>' <selected-file> <dialect> <encoding>`, using the
host's argument-passing or shell-quoting rules. Replace the placeholders with real
values; `utf-8` is appropriate only when established from the source. Use `utf-8-sig`
for a UTF-8 BOM or the actual export encoding for other files, never lossy decoding.
No persistent custom extraction script or additional extraction-result file is needed.

```python
import hashlib
import json
import sys
from pathlib import Path

import sqlglot
from sqlglot import exp
from sqlglot.dialects import Dialect
from sqlglot.errors import ErrorLevel, ParseError, TokenError

source_path = Path(sys.argv[1])
dialect = sys.argv[2]
encoding = sys.argv[3]
Dialect.get_or_raise(dialect)
source_bytes = source_path.read_bytes()
source_sql = source_bytes.decode(encoding)
report = {
		"file": str(source_path),
		"sha256": hashlib.sha256(source_bytes).hexdigest(),
		"dialect": dialect,
		"version": sqlglot.__version__,
}
try:
		trees = sqlglot.parse(source_sql, read=dialect, error_level=ErrorLevel.RAISE)
except ParseError as error:
		report["parseErrors"] = error.errors
		print(json.dumps(report))
		raise SystemExit(1)
except TokenError as error:
		report["tokenError"] = str(error)
		print(json.dumps(report))
		raise SystemExit(1)

report["statements"] = [
		{
				"statement": ordinal,
				"kind": tree.key if tree is not None else "empty",
				"opaque": any(isinstance(node, exp.Command) for node in tree.walk()) if tree is not None else False,
				"ast": tree.dump() if tree is not None else None,
		}
		for ordinal, tree in enumerate(trees, 1)
]
print(json.dumps(report))
```

Inspect both stdout and stderr. `parse` returns the statement collection; do not use
`parse_one` to inventory a file. A `None` entry is an empty/comment-only parse result,
not a table. `dump()` emits JSON-compatible AST nodes and available token metadata;
`repr(tree)` is a readable alternative when examining a single tree.

- `ParseError.errors` carries descriptions and line/column context. Tokenization,
	decoding, and I/O failures also mean the file was not successfully inspected. Keep
	the failure and source location visible; do not retry with `IGNORE` to clear it.
- `ErrorLevel.RAISE` does not turn SQLGlot into a validator and does not reject all
	unsupported constructs. Check every tree for `exp.Command` and read warnings.
	`opaque: true` means the statement needs explicit source review, not that it was
	parsed structurally. Even `opaque: false` does not establish source-engine validity.
- A supported dialect with an unsupported statement is not an unavailable parser.
	Keep SQLGlot evidence for parsed statements and identify any model-reviewed remainder
	in the summary. Do not fabricate structure or label that remainder AST-verified.
	Record unresolved source-correctness failures in `sourceInventory.errors`; apply
	the [preflight blocker rules](../phases/preflight.md#2-schema-acquisition).
- Repeat for every selected file in established source order. Read large AST output
	in bounded portions and track unreviewed statements; truncation is not completion.
	Reconcile statement ordinals and source locations against the original text. Do
	not split on semicolons or strip `GO`, `DELIMITER`, or procedural bodies with regex.
	If host-side batch separation is necessary, establish dialect-aware boundaries and
	preserve original line offsets, delimiters, and an explicit disposition for each batch.

## AST to Inventory

Start from each statement's owner, not a global search for every `Table` or `Column`:
referenced tables, view inputs, and columns in expressions are not declarations.
`node.this`, `node.expressions`, and `node.args` expose children; `find_all(...)`
searches descendants and must stay scoped to the definition being interpreted.

| Source construct | AST navigation and interpretation |
| --- | --- |
| `CREATE TABLE ... (...)` | Check `isinstance(tree, exp.Create)` and `tree.args.get("kind") == "TABLE"`. For an explicit definition, `tree.this` is `exp.Schema`, its `.this` is the owning `exp.Table`, and `.expressions` contains columns and table constraints. CTAS/LIKE and other shapes require separate review. |
| Qualified identity | The owning `Table.parts` gives ordered identifiers. Preserve each `.name` and `.args.get("quoted", False)`; never split a rendered name on dots or lowercase quoted identifiers. Resolve omitted catalog/schema from source context and apply dialect case rules before matching identities. |
| Column | Direct `exp.ColumnDef` children have `.this` as the identifier, `.args["kind"]` as the type, and `.args.get("constraints", [])` as column constraints. Preserve declared types, length, precision/scale, aliases, and source spelling; generated `.sql(dialect=dialect)` may normalize synonyms. |
| Inline constraints | Inspect each `exp.ColumnConstraint.args["kind"]`: commonly `NotNullColumnConstraint`, `PrimaryKeyColumnConstraint`, `UniqueColumnConstraint`, `DefaultColumnConstraint`, `CheckColumnConstraint`, `GeneratedAsIdentityColumnConstraint`, or `Reference`. Default/check expressions are in `.this`. Determine nullability from explicit constraints and source-dialect rules, not solely absence of `NOT NULL`. |
| Named/table constraints | `exp.Constraint` wraps a name in `.this` and definitions in `.expressions`. `exp.PrimaryKey.expressions` preserves key order. `exp.UniqueColumnConstraint` may wrap an `exp.Schema`; inspect its children, not a guessed fixed shape. Retain check predicates and constraint options. |
| Foreign key | `exp.ForeignKey.expressions` gives local columns in order. `.args["reference"]` is `exp.Reference`; for an explicit referenced column list, `.this` is `exp.Schema` with the referenced `Table` in `.this` and columns in `.expressions`. Inline `Reference` belongs to its enclosing column. Resolve omitted referenced columns from source key evidence, not guesses; retain referential actions. |
| `ALTER TABLE` | `exp.Alter.this` is the affected table; `.args["actions"]` is ordered. `ADD COLUMN` can be a `ColumnDef`; `ADD CONSTRAINT` can be `AddConstraint.expressions` containing `Constraint`. Apply additions, changes, renames, and drops to the working inventory in source order, never to source files. |
| Other statements | Inspect views, indexes, sequences, triggers, types, schema/session changes, and procedural constructs separately. Record dependencies, behavioral effects, and disposition even when they add no table. |

Identifiers often have `.meta` with `line`, `col`, `start`, and `end`. These describe
tokens, not guaranteed whole-statement spans. Attach the original file and statement
ordinal, verify line locations against source, and obtain missing locations by direct
reading. Adjust offsets if parsing a batch. Never invent spans from absent metadata.

Maintain one working inventory across the selected set. Resolve forward references
after processing all declarations and ordered alterations; preserve composite-key
order. Review every source statement a second time against the resulting inventory,
including non-table objects and duplicate or quoted-name distinctions.

Write only the reconciled result into `preflight-manifest.json#sourceInventory` using
the [inventory contract](../contracts/validation-evidence.md#inventory-in-the-preflight-manifest).
The diagnostic report above is not that inventory: add its actual parser version,
workspace-relative file paths and exact-byte hashes to the contract fields, record
remaining errors, and compute `sourceSha256` as specified there. Retain additional
constraints, source locations, and statement dispositions in that same result. Clear
errors only after resolution; successful JSON validation cannot establish DDL correctness.

## Worked CREATE and ALTER Example

For this PostgreSQL input, establish the owning tables from statements 1 and 2, add
`note` to `public.orders` from statement 3, then attach its foreign key from statement 4:

```sql
CREATE TABLE public.customers (
		id INT PRIMARY KEY
);
CREATE TABLE public.orders (
		id INT PRIMARY KEY,
		customer_id INT NOT NULL,
		total NUMERIC(12, 2) DEFAULT 0 CHECK (total >= 0)
);
ALTER TABLE public.orders ADD COLUMN note VARCHAR(40);
ALTER TABLE public.orders ADD CONSTRAINT orders_customer_fk
		FOREIGN KEY (customer_id) REFERENCES public.customers(id);
```

`trees[1].this` is the orders schema. Its direct column definitions own the three
original columns; `trees[2].args["actions"][0]` is the added column. The last action
wraps the named foreign key in `AddConstraint` then `Constraint`. This yields the
following orders table entry (source locations are relative to this example):

```json
{
	"name": "public.orders",
	"identity": [{ "name": "public", "quoted": false }, { "name": "orders", "quoted": false }],
	"columns": [
		{ "name": "id", "type": "INT", "nullable": false, "source": { "statement": 2, "line": 5 } },
		{ "name": "customer_id", "type": "INT", "nullable": false, "source": { "statement": 2, "line": 6 } },
		{
			"name": "total", "type": "NUMERIC(12, 2)", "nullable": true,
			"precision": 12, "scale": 2, "default": "0", "checks": ["total >= 0"],
			"source": { "statement": 2, "line": 7 }
		},
		{ "name": "note", "type": "VARCHAR(40)", "nullable": true, "length": 40, "source": { "statement": 3, "line": 9 } }
	],
	"primaryKey": ["id"],
	"foreignKeys": [{
		"name": "orders_customer_fk", "columns": ["customer_id"],
		"referencedTable": "public.customers", "referencedColumns": ["id"],
		"source": { "statement": 4, "line": 10 }
	}],
	"source": { "statement": 2, "line": 4 }
}
```

This is one table entry, not a complete manifest. Also include `public.customers`
with its `id` column and primary key, the parser metadata, actual file paths/hashes,
source-file links for these locations, statement accounting, and unresolved errors.
Do not copy the example's schema names or locations into another migration.

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
available, follow the existing unavailable-parser fallback or abort policy in
[DDL interpretation](../workflow/ddl-interpretation.md#dependency-choice).
