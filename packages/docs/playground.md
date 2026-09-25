---
title: Playground
description: Explore SQL language features and JSON schema inference locally in your browser.
aside: false
outline: false
---

<script setup>
import { defineClientComponent } from 'vitepress';

const Playground = defineClientComponent(() => import('./components/Playground.vue'));
</script>

# Playground

Explore the published language service and JSON schema analyzer with synthetic documents. Query analysis runs locally in your browser: **SQL is parsed, not executed**, and no Cosmos DB connection or credentials are needed.

<Playground />

## Try a focused experiment

Selecting a sample immediately loads its SQL query without replacing your JSON documents or applied schema.
Unapplied document edits are preserved too; use **Apply schema** when you want to update field suggestions.
Sample queries may reference fields absent from your schema. This does not prevent syntax analysis; suggestions use
your applied schema, and SQL is not executed.

- Request field completion after `c.` in `SELECT c. FROM c`.
- Hover a built-in function; in Monaco, also place the cursor inside its argument list for signature help.
- Change `FROM` to `FORM` and inspect diagnostics.
- Compare a single query with semicolon-separated statements.
- Use documents with a missing field or two types for the same field, then inspect the inferred schema.

Incomplete queries are normal editor input; diagnostics and useful completions can coexist. A clean diagnostic list does not guarantee that a query will run against Cosmos DB.

Use only synthetic, non-sensitive input. The playground does not intentionally upload query or document contents; loading the site still involves normal requests for static assets. Do not paste secrets, customer data, or private schema names.

For executable integrations, see [Monaco](./monaco.md), [CodeMirror](./codemirror.md), and [schema analysis](./schema-analyzer.md). [VS Code integration](./vscode.md) is demonstrated as extension-host source, not an embedded browser editor. Review [limitations](./limitations.md) before adapting the examples.
