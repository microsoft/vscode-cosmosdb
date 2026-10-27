---
title: Scope, preview, and confirm Cosmos DB Shell writes and deletions
impact: HIGH
impactDescription: prevents unintended data loss, unexpected cost changes, and duplicate writes
tags: tooling, cosmosdb-shell, mcp, writes, destructive-operations, safety
---

## Scope, Preview, and Confirm Cosmos DB Shell Writes and Deletions

A request to inspect or diagnose data is not permission to change it. Run writes through Cosmos DB Shell only when the user asks for them. Before a write, verify the account (see `tooling-cosmosdb-shell-target`), database, container, and the affected item's `id` and partition key, and read the current state when relevant.

**Single-item deletion preflight, including when explaining a proposed procedure:**

1. Verify the account, database, container, and intended customer. An unscoped `rm` pattern matches partition keys by default, not IDs. Stop until the target is unambiguous.
2. Keep the exact non-wildcard ID, `key=id`, complete correctly typed partition key, database, and container identical in preview and execution. Require one intended item and inspect its ID, partition key, and ETag, not just a count.
3. Use that actual preview ETag on execution. Stop on a mismatch or unsupported safety options; never refresh the ETag automatically or retry without the condition.
4. Explain cost: exact ID plus partition key uses point operations; other patterns can scan and consume substantial RUs, and a partition key restricts scans to that partition.
5. Remind the user to back up important data and preserve the MCP confirmation gate. Do not bypass declined or unavailable confirmation with force, a terminal, or another tool.
6. Verify success with a narrow read. If the result is uncertain, inspect current state before retrying; never claim deletion without evidence.

If the user asks only for an explanation, do not execute writes. If Shell MCP is unavailable, say so and describe the proposed procedure without claiming tool discovery or execution; do not install tools or switch to another execution route to answer.

Through MCP, call the Shell tool named after the command with structured arguments (`--database=MyDb` becomes `"database": "MyDb"`, `--dry-run` becomes `"dry-run": true`, positional values use their parameter names). The `bash` blocks are the equivalent interactive Cosmos DB Shell commands, not system terminal commands to run instead of MCP.

**Incorrect (deleting by an assumed ID, relying on navigation, and trying to skip confirmation):**

```jsonc
// MCP tool calls
{ "name": "cd", "arguments": { "item": "Orders" } }
{ "name": "rm", "arguments": { "pattern": "order-123" } }           // matches the partition key by default, not id
{ "name": "rmdb", "arguments": { "name": "OldDb", "force": true } }  // force skips only the interactive prompt, not MCP confirmation
```

```bash
# Interactive Cosmos DB Shell equivalent
cd Orders
rm order-123
rmdb OldDb true
```

**Correct (preview an exact item in its partition, then delete only the reviewed version):**

```jsonc
// MCP tool calls
{ "name": "info", "arguments": { "database": "MyDb", "container": "Orders" } }  // confirm the partition key path is /customerId
{ "name": "rm", "arguments": { "pattern": "order-123", "key": "id", "partition-key": "customer-42", "database": "MyDb", "container": "Orders", "dry-run": true } }
```

```bash
# Interactive Cosmos DB Shell equivalent
info --database=MyDb --container=Orders
rm order-123 --key=id --partition-key=customer-42 --database=MyDb --container=Orders --dry-run
```

The exact-item preview returns the count, ID, partition key, and current ETag:

```json
{ "type": "item", "count": 1, "dryRun": true, "partitionKey": "customer-42", "id": "order-123", "etag": "\"00000000-0000-0000-0000-000000000000\"" }
```

Verify that the preview identifies the intended item before requesting deletion. The ETag below is illustrative; use the actual ETag returned by the preview, including its embedded double quotes.

```jsonc
// MCP tool call, only after verifying the preview
{ "name": "rm", "arguments": { "pattern": "order-123", "key": "id", "partition-key": "customer-42", "etag": "\"00000000-0000-0000-0000-000000000000\"", "database": "MyDb", "container": "Orders" } }
```

```bash
# Interactive Cosmos DB Shell equivalent, using the ETag from the preview
rm order-123 --key=id --partition-key=customer-42 --etag '"00000000-0000-0000-0000-000000000000"' --database=MyDb --container=Orders
```

- **Match the right item.** `rm` and `delete item` patterns match the partition key by default; `key` set to `id` (shell `--key=id`) without partition-key scoping matches the ID across *all* partitions, where the same ID may occur more than once. Wildcards such as `test-*` can match many items. For a single-item `rm`, use an exact ID without `*` or `?`, `key` set to `id`, and `partition-key` (shell `--partition-key`, alias `--pk`) in both preview and execution. The partition key must be complete, including every component for hierarchical keys. Preserve its type: JSON scalars retain their type, and hierarchical keys use a JSON array.
- **Account for scan costs.** An exact-ID `rm` with `key` set to `id` and an explicit partition key uses a point read for preview and a point delete for execution rather than scanning the container. Other pattern operations scan items to find matches; supplying a partition key restricts both preview and deletion to that logical partition. Preview and deletion can consume substantial RUs when scanning large scopes. Explain that cost before proceeding; if a scan is unacceptable, stop and discuss alternatives rather than silently switching tools or bypassing confirmation.
- **Check the preview, not just its completion.** A dry run (`"dry-run": true`, shell `--dry-run`) reports a match count. Exact-ID `rm` with an explicit partition key also returns the item's `id`, `partitionKey`, and `etag`; verify all of them. For a single-item deletion, if the count is zero, greater than one, or otherwise uncertain, stop and clarify. A count alone cannot make an unscoped single-item `rm` safe. `rmcon`, `rmdb`, and `delete` also support a dry run.
- **Protect the reviewed version.** Pass the ETag from the exact-item preview to `etag` (shell `--etag`) on execution. Cosmos DB enforces the condition through `If-Match`, so an update or recreation after preview causes deletion to fail rather than deleting an unreviewed version. Report an ETag mismatch and stop; do not automatically refresh the ETag or retry without the condition. `rm` rejects ETag conditions for wildcard patterns, piped input, missing `key=id` or partition key, and empty ETags. If the installed Shell lacks these options, stop rather than falling back to an unscoped deletion.
- **Explain consequences first.** Before running an import, batch, patch, replace, indexing, throughput, or TTL change, describe its scope and effect. `create ... -force` upserts and can overwrite items. `ttl set` and `ttl on` can cause items to expire. Throughput changes affect cost. Clarify ambiguous targets or effects before acting.
- **Honor the confirmation gate.** Invoke `delete`, `rm`, `rmcon`, and `rmdb` only for an explicit user request, and remind the user to back up important data. The MCP server shows the command, endpoint, and navigation location, then asks the user to approve it. Force arguments do not bypass this prompt. Never use a terminal, another tool, or a different command to work around it.
- **Stop when confirmation fails.** A declined prompt is not permission to try another route. If the client cannot display the prompt, the server refuses the command; give the user the verified command to run manually. If the connection or navigation changed while confirmation was pending, the server refuses the command. Re-verify the target before trying again.
- **Verify the outcome.** After a write, confirm the result with a narrow, bounded read. If a call times out or its outcome is unclear, inspect the current state before retrying so that non-idempotent writes are not duplicated. Through MCP, transactional batches must use the one-shot `batch run`; stateful batch subcommands are available only in the interactive shell.

Reference: [Cosmos DB Shell rm command](https://github.com/Azure/CosmosDBShell/blob/main/docs/commands.md#rm), [MCP destructive command confirmation](https://github.com/Azure/CosmosDBShell/blob/main/docs/mcp.md#destructive-command-confirmation)
