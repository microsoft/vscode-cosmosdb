---
title: Version Your Document Schemas
impact: MEDIUM
impactDescription: enables safe schema evolution
tags: model, schema, versioning, migration
---

## Version Your Document Schemas

Include schema version in documents to handle evolution gracefully. This enables safe migrations and backward-compatible reads.

**Incorrect (no version tracking):**

```csharp
// Original schema
public class UserV1
{
    public string Id { get; set; }
    public string Name { get; set; }  // Later split into FirstName + LastName
    public string Address { get; set; }  // Later becomes Address object
}

// After schema change, old documents break deserialization
public class User
{
    public string Id { get; set; }
    public string FirstName { get; set; }  // Null for old docs!
    public string LastName { get; set; }   // Null for old docs!
    public Address Address { get; set; }   // Deserialization fails!
}
```

**Correct (versioned documents):**

```csharp
public abstract class UserBase
{
    public string Id { get; set; }
    public int SchemaVersion { get; set; }
}

public class UserV1 : UserBase
{
    public string Name { get; set; }
    public string Address { get; set; }
}

public class UserV2 : UserBase
{
    public string FirstName { get; set; }
    public string LastName { get; set; }
    public AddressV2 Address { get; set; }
}

// Read with version handling
public async Task<User> GetUserAsync(string id, string partitionKey)
{
    var response = await container.ReadItemStreamAsync(id, new PartitionKey(partitionKey));
    using var doc = await JsonDocument.ParseAsync(response.Content);
    var version = doc.RootElement.GetProperty("schemaVersion").GetInt32();
    
    return version switch
    {
        1 => MigrateV1ToV2(JsonSerializer.Deserialize<UserV1>(doc)),
        2 => JsonSerializer.Deserialize<UserV2>(doc),
        _ => throw new NotSupportedException($"Unknown schema version: {version}")
    };
}

// Background migration using Change Feed
public async Task MigrateUserDocuments()
{
    var changeFeed = container.GetChangeFeedProcessorBuilder<UserV1>("migration", HandleChanges)
        .WithInstanceName("migrator")
        .WithStartTime(DateTime.MinValue.ToUniversalTime())
        .Build();
    await changeFeed.StartAsync();
}
```

Always increment version when:
- Adding required fields
- Changing field types
- Restructuring nested objects

Reference: [Schema evolution in Cosmos DB](https://learn.microsoft.com/azure/cosmos-db/nosql/modeling-data)
