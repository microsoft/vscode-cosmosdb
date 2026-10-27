---
title: Diagnose Cosmos DB Shell MCP problems without changing the user's environment
impact: MEDIUM
impactDescription: isolates installation, MCP, and connection failures while avoiding unsafe credential and environment changes
tags: tooling, cosmosdb-shell, mcp, troubleshooting, credentials, vscode
---

## Diagnose Cosmos DB Shell MCP Problems Without Changing the User's Environment

When Cosmos DB Shell tools are missing or failing, first check the client's available tools. Then determine which of these applies: the Shell is not installed, MCP is disabled or unconfigured, the MCP server failed to start (for example, because of a port conflict), or the Shell cannot reach or authenticate to the database. Each needs a different fix.

**Incorrect (changing the environment and handling secrets in chat):**

```text
- Kill whatever process is listening on the MCP port
- Ask the user to paste the account key and run connect with it
- Run a command MCP refused through a terminal instead
```

**Correct (read-only diagnostics first, changes only with the user's consent):**

When the Shell's MCP tools are available, call them with structured arguments (`--database=MyDb` becomes `"database": "MyDb"`; a positional value such as the `can-i` action uses its parameter name). When MCP is unavailable, give the user the equivalent commands to run in the interactive Cosmos DB Shell; do not run them in a system terminal as a substitute for MCP.

```jsonc
// MCP tool calls
{ "name": "doctor", "arguments": { "format": "json" } }  // read-only; works while disconnected; omits endpoints and secrets
{ "name": "whoami", "arguments": {} }                    // credential type and, for Entra ID, the principal
{ "name": "can-i", "arguments": { "action": "query", "database": "MyDb", "container": "Orders" } }
```

```bash
# Interactive Cosmos DB Shell equivalent
doctor --format json
whoami
can-i query --database=MyDb --container=Orders
```

- **Install only with consent.** If the Shell is not installed, explain the options and let the user choose; do not install it yourself unless asked. In VS Code, install the **Azure Cosmos DB** extension (`ms-azuretools.vscode-cosmosdb`) and run the `cosmosDB.launchCosmosDBShell` command to install the Shell. Outside VS Code, install the .NET global tool (requires the .NET SDK 10.0 or later) or download a self-contained binary from the installation guide. Verify the installation with `cosmosdbshell --version`, then start the MCP server with `cosmosdbshell --mcp` (default port 6128) or enable it in the client.

  ```bash
  # System terminal, installation only; run with the user's consent
  dotnet tool install --global CosmosDBShell --prerelease
  cosmosdbshell --version
  cosmosdbshell --mcp
  ```
- **Diagnose without side effects.** `doctor` reports DNS, TLS, authentication, and permission verdicts without changing the connection, navigation, or settings. `can-i read|query|write|manage` checks access without modifying data. Do not install software, change settings, switch connections, or end the process using a port just to answer a question. For a port conflict, suggest another MCP port instead.
- **Protect credentials.** Never ask users to paste account keys, tokens, or connection strings into chat, and never print them. Prefer Entra ID and the client's connection flow. The Shell records MCP commands in replayable history, including any connection strings they contain. Export data only to a destination the user approves.
- **Respect MCP restrictions.** MCP cannot run `sproc`, `udf`, `trigger`, `watch`, or stateful `batch` subcommands. Explain the limitation and give the user a verified command to run in the interactive shell; do not silently switch to a terminal to bypass it. The MCP server (`--mcp`, default port 6128) runs with the user's permissions. Keep it bound to `127.0.0.1` and do not expose it beyond the local machine.
- **VS Code integration.** The Azure Cosmos DB extension registers the **Azure Cosmos DB Shell** MCP server when the Shell is installed and `cosmosDB.shell.MCP.enabled` is on. `cosmosDB.shell.path` selects a custom executable, `cosmosDB.shell.MCP.port` sets the port, and the `cosmosDB.launchCosmosDBShell` command opens the Shell or its install and repair flow. Ask the user before enabling MCP, or before closing and relaunching a Shell started without MCP. Other clients use their own MCP configuration. Do not assume the VS Code NoSQL Query Editor shares the Shell's connection or container.

Reference: [Cosmos DB Shell overview](https://learn.microsoft.com/azure/cosmos-db/shell/overview) · [Install Cosmos DB Shell](https://learn.microsoft.com/azure/cosmos-db/shell/install) · [MCP security](https://github.com/Azure/CosmosDBShell/blob/main/docs/mcp.md#security)
