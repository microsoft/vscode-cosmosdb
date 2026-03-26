---
title: Use consistent enum serialization between Cosmos SDK and application layer
impact: critical
tags: [sdk, serialization, enums, bug-prevention]
---

# Use Consistent Enum Serialization

## Problem

The Cosmos DB SDK's default serializer stores enums as **integers**, but many application frameworks (ASP.NET Core, Spring Boot) serialize enums as **strings** in API responses. This mismatch causes queries to fail silently - returning empty results when filtering by enum values.

## Example Bug

```csharp
// Model with enum
public class Order
{
    public OrderStatus Status { get; set; }  // Stored as integer: 1
}

// Query looks for string - FINDS NOTHING!
var query = new QueryDefinition("SELECT * FROM c WHERE c.status = @status")
    .WithParameter("@status", "Shipped");  // ❌ Wrong - Cosmos has integer 1
```

## Solution

### Option 1: Configure Cosmos SDK to use string serialization (Recommended)

**.NET - Use System.Text.Json with string enums:**
```csharp
var clientOptions = new CosmosClientOptions
{
    Serializer = new CosmosSystemTextJsonSerializer(new JsonSerializerOptions
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        Converters = { new JsonStringEnumConverter() }
    })
};
var client = new CosmosClient(endpoint, key, clientOptions);
```

**Java - Use Jackson with string enums:**
```java
ObjectMapper mapper = new ObjectMapper();
mapper.configure(SerializationFeature.WRITE_ENUMS_USING_TO_STRING, true);
mapper.configure(DeserializationFeature.READ_ENUMS_USING_TO_STRING, true);

CosmosClientBuilder builder = new CosmosClientBuilder()
    .endpoint(endpoint)
    .key(key)
    .customSerializer(new JacksonJsonSerializer(mapper));
```

**Python - Enums serialize as strings by default with proper setup:**
```python
from enum import Enum

class OrderStatus(str, Enum):  # Inherit from str for JSON serialization
    PENDING = "pending"
    SHIPPED = "shipped"
    DELIVERED = "delivered"
```

### Option 2: Query using integer values

If you can't change the serializer, query with the integer value:

```csharp
// Query with integer value
var query = new QueryDefinition("SELECT * FROM c WHERE c.status = @status")
    .WithParameter("@status", (int)OrderStatus.Shipped);  // ✅ Matches stored data
```

### Option 3: Store status as string explicitly

```csharp
public class Order
{
    // Store as string, not enum
    public string Status { get; set; } = "Pending";
}
```

## Best Practice

**Always verify serialization consistency** by:
1. Creating a test document
2. Reading it back via the SDK
3. Querying it with a filter
4. Checking the raw JSON in Data Explorer

## Warning Signs

- Queries return empty results but you know matching documents exist
- Point reads work but filtered queries don't
- API returns different enum format than stored in Cosmos DB
