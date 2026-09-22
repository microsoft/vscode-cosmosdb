---
title: Avoid Microsoft.Azure.Cosmos namespace collisions with domain models
impact: HIGH
impactDescription: prevents CS0104 build-breaking ambiguous reference errors
tags: sdk, dotnet, namespace, collision, using, CS0104
---

## Avoid Microsoft.Azure.Cosmos Namespace Collisions with Domain Models

The `Microsoft.Azure.Cosmos` namespace exports top-level types including `User`, `Database`, `Container`, `Conflict`, `Trigger`, and `Permission`. When an application defines a domain entity by the same name and both namespaces are imported with unqualified `using` directives in the same file, every reference to the shared name becomes ambiguous and the build fails with **CS0104**.

**Incorrect (ambiguous reference — CS0104):**

```csharp
using ECommerce.Core.Models;      // defines User
using Microsoft.Azure.Cosmos;     // also defines User

public class UserRepository
{
    private readonly Container _container;

    public UserRepository(CosmosClient client)
        => _container = client.GetContainer("db", "users");

    // CS0104: 'User' is an ambiguous reference between
    // 'ECommerce.Core.Models.User' and 'Microsoft.Azure.Cosmos.User'
    public async Task<User> GetUserAsync(string id, string partitionKey)
        => await _container.ReadItemAsync<User>(id, new PartitionKey(partitionKey));
}
```

**Correct (alias the SDK import):**

```csharp
using Cosmos = Microsoft.Azure.Cosmos;
using ECommerce.Core.Models;      // defines User — no collision

public class UserRepository
{
    private readonly Cosmos.Container _container;

    public UserRepository(Cosmos.CosmosClient client)
        => _container = client.GetContainer("db", "users");

    public async Task<User> GetUserAsync(string id, string partitionKey)
        => await _container.ReadItemAsync<User>(id, new Cosmos.PartitionKey(partitionKey));
}
```

**Also correct (fully qualify SDK types):**

```csharp
using ECommerce.Core.Models;

public class UserRepository
{
    private readonly Microsoft.Azure.Cosmos.Container _container;

    public UserRepository(Microsoft.Azure.Cosmos.CosmosClient client)
        => _container = client.GetContainer("db", "users");

    public async Task<User> GetUserAsync(string id, string partitionKey)
        => await _container.ReadItemAsync<User>(
            id, new Microsoft.Azure.Cosmos.PartitionKey(partitionKey));
}
```

**Key points:**
- Do not place both `using Microsoft.Azure.Cosmos;` and a domain `using` that exposes a colliding name (`User`, `Database`, `Container`, etc.) in the same file.
- Prefer the alias approach (`using Cosmos = Microsoft.Azure.Cosmos;`) — it keeps code concise while eliminating ambiguity.
- Common colliding names: `User`, `Database`, `Container`, `Conflict`, `Trigger`, `Permission`.

Reference: [C# CS0104 — ambiguous reference](https://learn.microsoft.com/dotnet/csharp/misc/cs0104)
