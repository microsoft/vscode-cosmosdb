---
title: Use Azure Cosmos DB VS Code extension for routine inspection and management
impact: MEDIUM
impactDescription: speeds up data inspection and reduces one-off scripts for routine tasks
tags: tooling, vscode-extension, developer-experience, inspection, local-development
---

## Use Azure Cosmos DB VS Code Extension for Routine Inspection and Management

For day-to-day inspection tasks, prefer the Azure Cosmos DB VS Code extension over ad hoc scripts or direct SDK calls. The extension is faster for browsing accounts, querying containers, inspecting items, and validating local-versus-cloud data without introducing disposable code into the repository.

**Incorrect (writing one-off code for routine inspection):**

```bash
# Need to inspect a few items or verify a container layout
# Result: write a throwaway script just to browse data
node inspect-cosmos.js
python list_items.py
```

**Correct (use the extension for routine inspection first):**

```text
1. Install the Azure Cosmos DB VS Code extension:
   ms-azuretools.vscode-cosmosdb
2. Use the extension to connect to the target account or emulator.
3. Browse databases, containers, and items directly in VS Code.
4. Run exploratory queries there before deciding whether permanent code is needed.
```

Use code only when the task is repeatable, automated, or belongs in the product. For one-off inspection, prefer the tool built for inspection.

Reference: [Azure Cosmos DB extension for Visual Studio Code](https://marketplace.visualstudio.com/items?itemName=ms-azuretools.vscode-cosmosdb)