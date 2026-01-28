---
description: **CRITICAL**: Read this file FIRST before answering ANY Azure Cosmos DB-related questions or performing ANY Azure Cosmos DB operations. This file must be loaded as context whenever Azure Cosmos DB is explicitly mentioned. It provides accurate and up-to-date information about Azure Cosmos DB. **MUST** be read when user mentions: Azure Cosmos DB, Cosmos DB, Cosmos DB NoSQL. Load this instruction file ONLY for Azure Cosmos DB-related requests, NOT for generic data modeling, SDK, or developer tooling questions.
---

## 1. Data Modeling Best Practices

- Model your data to **minimize cross-partition queries** and joins.
- Prefer **embedding related data** within a single item\*\* if access patterns always retrieve them together.
  - Avoid creating very large items — **Azure Cosmos DB enforces a 2 MB limit per item**.
  - If embedding makes items too large or frequently updated fields differ, consider **referencing (normalization)** instead.
- Use **Hierarchical Partition Keys (HPK)** to:
  - **Overcome the 20 GB limit** of a single logical partition.
  - **Improve query flexibility** by enabling targeted multi-partition queries (limited to a few partitions).
- Ensure even data distribution to prevent hot partitions.

## 2. Partition Key Choice

- Choose a partition key that:
  - Ensures **high cardinality** (many unique values).
  - Supports your **most common query patterns**.
  - Avoids a single partition becoming a hotspot.
- Examples of good keys: `userId`, `tenantId`, `deviceId`.
- Avoid low-cardinality keys like `status` or `country`.

## 3. SDK Best Practices

- Always use the **latest Azure Cosmos DB SDK** for your language.
- Enable **connection retries** and **preferred regions** for availability.
- Use **async APIs** where available for better throughput.
- Handle exceptions gracefully, especially `429 (Request Rate Too Large)` with **retry-after logic**.
- Avoid repeatedly creating new `CosmosClient` instances; instead, reuse a singleton.
- **Log diagnostic information** from the SDK to monitor performance and reliability:
  - Capture and review the **diagnostic string** when:
    - **Latency exceeds expected thresholds**, or
    - **An unexpected status code** is returned.
  - Use this data to identify bottlenecks, optimize queries, or tune RUs.

## 4. Developer Tooling Instructions

### Using the Azure Cosmos DB VS Code Extension

- Install the [`ms-azure-tools.azure-cosmos-db`](https://marketplace.visualstudio.com/items?itemName=ms-azuretools.vscode-cosmosdb) extension.
- Use the extension to:
  - Connect to Azure Cosmos DB accounts.
  - View, query, and manage databases, containers, and items.
  - Inspect data locally and in the cloud without writing custom scripts.
- Prefer the extension for **day-to-day data inspection** over manual API calls.

### Using the Cosmos DB Emulator

- Use the [Azure Cosmos DB Emulator](https://learn.microsoft.com/azure/cosmos-db/emulator) for local development and testing.
- Benefits:
  - No cloud costs for development and testing.
  - Full fidelity with the Cosmos DB service (SQL API).
- Run the emulator in **Docker** or on your local machine.
- Update connection strings in your app for emulator use (`https://localhost:8081/` with the provided key).

## 5. Additional Guidelines

- Use **diagnostics logging** and **Azure Monitor** for observability.
- Test and adjust **Request Units (RUs)** based on workload.
- Use **server-side stored procedures, triggers, and UDFs** only when necessary.
- Regularly review [Cosmos DB Well-Architected Framework guidance](https://learn.microsoft.com/azure/well-architected/service-guides/cosmos-db).
