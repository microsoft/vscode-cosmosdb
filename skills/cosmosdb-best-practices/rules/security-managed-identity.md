---
title: Use Managed Identity with DefaultAzureCredential
impact: CRITICAL
impactDescription: zero-secret authentication for all environments
tags: security, managed-identity, authentication, DefaultAzureCredential
---

## Use Managed Identity with DefaultAzureCredential

**Impact: CRITICAL (zero-secret authentication for all environments)**

Authenticate to Cosmos DB using managed identity and `DefaultAzureCredential`. This provides a single code path that works in local development (via `az login`), Azure compute (via system-assigned managed identity), and CI/CD (via service principal or federated identity) — with no secrets in code or configuration.

**Incorrect (hard-coded keys or environment-specific auth):**

```csharp
// WRONG: Key stored in configuration
var client = new CosmosClient(
    "https://myaccount.documents.azure.com:443/",
    "abc123masterkey=="
);

// WRONG: Connection string in environment variable still contains a secret
var connectionString = Environment.GetEnvironmentVariable("COSMOS_CONNECTION_STRING");
var client = new CosmosClient(connectionString);

// WRONG: Different auth code per environment
if (isDevelopment)
    client = new CosmosClient(connectionString);  // key-based
else
    client = new CosmosClient(endpoint, new ManagedIdentityCredential());  // identity
```

**Correct (DefaultAzureCredential everywhere):**

```csharp
using Azure.Identity;
using Microsoft.Azure.Cosmos;

// Same code works in all environments:
// - Local dev: uses az login / Visual Studio / VS Code credentials
// - Azure (App Service, Functions, Container Apps, AKS): uses managed identity
// - CI/CD: uses service principal or workload identity federation
var client = new CosmosClient(
    accountEndpoint: "https://myaccount.documents.azure.com:443/",
    tokenCredential: new DefaultAzureCredential()
);
```

```python
from azure.identity import DefaultAzureCredential
from azure.cosmos import CosmosClient

credential = DefaultAzureCredential()
client = CosmosClient("https://myaccount.documents.azure.com:443/", credential)
```

```javascript
const { DefaultAzureCredential } = require("@azure/identity");
const { CosmosClient } = require("@azure/cosmos");

const credential = new DefaultAzureCredential();
const client = new CosmosClient({
    endpoint: "https://myaccount.documents.azure.com:443/",
    aadCredentials: credential
});
```

```java
import com.azure.identity.DefaultAzureCredentialBuilder;
import com.azure.cosmos.CosmosClientBuilder;

CosmosClient client = new CosmosClientBuilder()
    .endpoint("https://myaccount.documents.azure.com:443/")
    .credential(new DefaultAzureCredentialBuilder().build())
    .buildClient();
```

For Azure compute, assign a system-assigned managed identity:

```bash
# App Service
az webapp identity assign --name <your-app> --resource-group <your-rg>

# Azure Functions
az functionapp identity assign --name <your-app> --resource-group <your-rg>

# Container Apps
az containerapp identity assign --name <your-app> --resource-group <your-rg> --system-assigned
```

Starting with `DefaultAzureCredential` from day one avoids a painful migration later — moving from keys to managed identity means touching every deployment, every environment, and potentially every SDK call.

Reference: [DefaultAzureCredential Class](https://learn.microsoft.com/dotnet/api/azure.identity.defaultazurecredential)
