---
title: Use Azure Cosmos DB Emulator for local development and testing
impact: MEDIUM
impactDescription: prevents accidental cloud usage and speeds up local iteration
tags: tooling, emulator, local-development, testing, developer-experience
---

## Use Azure Cosmos DB Emulator for Local Development and Testing

Prefer the Azure Cosmos DB Emulator for local development, exploratory testing, and repeatable developer workflows. It avoids cloud cost during local work, keeps feedback loops fast, and reduces the risk of accidentally using shared or production resources while iterating.

**Incorrect (local development against cloud resources by default):**

```yaml
# Local development profile
azure:
  cosmos:
    endpoint: https://my-prod-account.documents.azure.com:443/
    key: ${COSMOS_KEY}
```

**Correct (default local development to the emulator):**

```yaml
# Local development profile
azure:
  cosmos:
    endpoint: https://localhost:8081/
    key: C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==
```

Run the emulator locally or in Docker, and keep production endpoints in environment-specific profiles or deployment configuration. For SDK-specific SSL and gateway-mode details, also apply the linked emulator configuration rules.

Related rules:
- `sdk-emulator-ssl`
- `sdk-local-dev-config`

Reference: [Use the Azure Cosmos DB Emulator for local development](https://learn.microsoft.com/azure/cosmos-db/emulator)