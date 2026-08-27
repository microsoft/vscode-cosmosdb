# Cosmos DB (NoSQL) Language Model Tools

This directory contains the VS Code **language model tools** that let the general Copilot agent
work with the Azure Cosmos DB for NoSQL Query Editor, plus small shared helpers. There is no
bespoke `@cosmosdb` chat participant and no in-extension NL2Query agentic loop — the extension
contributes tools and lets the Copilot agent orchestrate them.

## Overview

The Query Editor's AI actions ("Generate query", "Explain query") route a prompt to the general
Copilot agent (`workbench.action.chat.open` in `agent` mode). The agent reads context, samples the
schema when needed, writes the query back, and can run it — all through the tools registered here.
Query-language rules live in the `cosmosdb-nosql-query-generation` skill; editor orchestration lives
in the `cosmosdb-nosql-query-editor` skill.

## Registered tools

| Tool name (`vscode.lm`)          | File                           | Purpose                                                                                                       |
| -------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `cosmosdb_getQueryEditorContext` | `getQueryEditorContextTool.ts` | Reads the active editor's current/selected query, connection, recent query history, and last result metadata. |
| `cosmosdb_sampleContainerSchema` | `sampleDataTool.ts`            | Samples documents from the container to infer property names/types (requires user approval).                  |
| `cosmosdb_applyQueryToEditor`    | `applyQueryToEditorTool.ts`    | Writes a generated query back into the active Query Editor.                                                   |
| `cosmosdb_executeCurrentQuery`   | `executeCurrentQueryTool.ts`   | Runs the current query in the Query Editor and waits for completion.                                          |
| `cosmosdb_listOpenConnections`   | `listOpenConnectionsTool.ts`   | Lists the currently open Query Editor connections.                                                            |
| `cosmosdb_openQueryEditor`       | `openQueryEditorTool.ts`       | Opens a Query Editor for a given connection.                                                                  |

All tools are registered during extension activation (see `src/extension.ts`) and are gated behind
their `onLanguageModelTool:*` activation events in `package.json`.

## Shared helpers

- `CosmosDbOperationsService.ts`: In-memory **query execution history** store, keyed by
  account/database/container. `QuerySession` records executions here after each run, and
  `getQueryEditorContextTool` reads it so the agent can see recent queries and their inferred schemas.
  No PII/document data is stored — only the query text, counts, request charge, and inferred schema.
- `chatUtils.ts`: Helpers for resolving the active Query Editor tab and its connection.
- `revealConnection.ts`: Reveals a connection in the Azure Resources tree.

## Prerequisites

- GitHub Copilot extension installed and enabled, with an active subscription (the agent and the
  language models come from Copilot).

## Related

- `skills/cosmosdb-nosql-query-generation/SKILL.md` — the NoSQL query-language rules and examples.
- `skills/cosmosdb-nosql-query-editor/SKILL.md` — how the agent drives the Query Editor tools.
- `docs/ai-agent-migration.md` — background on moving from the hand-rolled loop to agent + tools.
