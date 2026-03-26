---
title: Enable Vector Search Feature on Account
impact: CRITICAL
impactDescription: Required before using vector search
tags: vector, configuration, feature, setup
---

## Enable Vector Search Feature on Account

**Impact: CRITICAL (Required before using vector search)**

Vector search must be explicitly enabled on the Azure Cosmos DB account before creating containers with vector policies. The feature can be enabled via Azure Portal or Azure CLI. Activation is auto-approved but may take up to 15 minutes to take effect.

**Important Notes:**
- Must be enabled **before** creating containers with vector policies
- Only supported on **new containers** (cannot modify existing containers)
- Feature activation takes up to 15 minutes
- Vector policies cannot be modified after container creation

**Enable via Azure Portal:**

1. Navigate to Azure Cosmos DB for NoSQL account
2. Select "Features" under Settings
3. Select "Vector Search for NoSQL API"
4. Review feature description
5. Click "Enable"

**Enable via Azure CLI:**

```bash
# Enable vector search capability on account
az cosmosdb update \
    --resource-group <resource-group-name> \
    --name <account-name> \
    --capabilities EnableNoSQLVectorSearch
```

**Verify Feature is Enabled (before creating containers):**

Wait 15 minutes after enabling, then verify:

```bash
# Check account capabilities
az cosmosdb show \
    --resource-group <resource-group-name> \
    --name <account-name> \
    --query "capabilities[?name=='EnableNoSQLVectorSearch']"
```

**Incorrect (attempting to use vectors without enabling feature):**

```csharp
// .NET - This will FAIL if feature not enabled
var embeddings = new List<Embedding>() { /* ... */ };
var properties = new ContainerProperties("docs", "/id")
{
    VectorEmbeddingPolicy = new(new Collection<Embedding>(embeddings))
};

await database.CreateContainerAsync(properties);
// Error: Vector search feature not enabled on account
```

**Correct (enable feature first, wait, then create):**

```bash
# Step 1: Enable feature
az cosmosdb update \
    --resource-group myResourceGroup \
    --name myCosmosAccount \
    --capabilities EnableNoSQLVectorSearch

# Step 2: Wait 15 minutes for feature to activate

# Step 3: Verify enabled
az cosmosdb show \
    --resource-group myResourceGroup \
    --name myCosmosAccount \
    --query "capabilities"

# Step 4: Now create containers with vector policies (see other rules)
```

**SDK Version Requirements:**
- **.NET**: SDK 3.45.0+ (release) or 3.46.0-preview.0+ (preview)
- **Python**: Latest Python SDK
- **JavaScript**: SDK 4.1.0+
- **Java**: Latest Java SDK v4

Reference: [.NET](https://learn.microsoft.com/en-us/azure/cosmos-db/how-to-dotnet-vector-index-query#enable-the-feature) | [Python](https://learn.microsoft.com/en-us/azure/cosmos-db/how-to-python-vector-index-query#enable-the-feature) | [JavaScript](https://learn.microsoft.com/en-us/azure/cosmos-db/how-to-javascript-vector-index-query#enable-the-feature) | [Java](https://learn.microsoft.com/en-us/azure/cosmos-db/how-to-java-vector-index-query#enable-the-feature)
