---
title: Use Direct Connection Mode for Production
impact: HIGH
impactDescription: reduces latency by 30-50%
tags: sdk, connection-mode, direct, performance
---

## Use Direct Connection Mode for Production

Use Direct connection mode for production workloads. Gateway mode adds an extra network hop and is only needed for firewall-restricted environments.

**Incorrect (defaulting to Gateway mode):**

```csharp
// Gateway mode adds extra hop through Azure gateway
var client = new CosmosClient(connectionString, new CosmosClientOptions
{
    ConnectionMode = ConnectionMode.Gateway  // Extra network hop!
});

// Request path:
// Client → Azure Gateway → Cosmos DB partition
// Extra latency: 2-10ms per request
```

**Correct (Direct mode for production):**

```csharp
var client = new CosmosClient(connectionString, new CosmosClientOptions
{
    // Direct mode connects straight to backend partitions
    ConnectionMode = ConnectionMode.Direct,
    
    // Protocol.Tcp for best performance (default in Direct mode)
    // Uses persistent connections
    
    // Configure connection limits for high throughput
    MaxRequestsPerTcpConnection = 30,
    MaxTcpConnectionsPerEndpoint = 65535,
    
    // Idle connection timeout
    IdleTcpConnectionTimeout = TimeSpan.FromMinutes(10),
    
    // Enable connection recovery
    EnableTcpConnectionEndpointRediscovery = true
});

// Request path:
// Client → Cosmos DB partition directly
// Lower latency, higher throughput
```

```csharp
// When to use Gateway mode (exceptions):
var gatewayClient = new CosmosClient(connectionString, new CosmosClientOptions
{
    // Use Gateway when:
    // 1. Corporate firewall blocks TCP port range 10000-20000
    // 2. Running in Azure Functions Consumption plan (sometimes)
    // 3. Kubernetes with restrictive network policies
    ConnectionMode = ConnectionMode.Gateway
});
```

```csharp
// Complete production configuration
var productionClient = new CosmosClient(connectionString, new CosmosClientOptions
{
    ApplicationName = "MyProductionApp",
    ConnectionMode = ConnectionMode.Direct,
    
    // Retry configuration
    MaxRetryAttemptsOnRateLimitedRequests = 9,
    MaxRetryWaitTimeOnRateLimitedRequests = TimeSpan.FromSeconds(30),
    
    // Connection management
    MaxRequestsPerTcpConnection = 30,
    MaxTcpConnectionsPerEndpoint = 65535,
    PortReuseMode = PortReuseMode.PrivatePortPool,
    
    // Serialization (optional optimization)
    SerializerOptions = new CosmosSerializationOptions
    {
        PropertyNamingPolicy = CosmosPropertyNamingPolicy.CamelCase,
        IgnoreNullValues = true
    },
    
    // Consistency (if different from account default)
    ConsistencyLevel = ConsistencyLevel.Session
});
```

Required firewall ports for Direct mode:
- TCP 443 (control plane)
- TCP 10000-20000 (data plane)

Reference: [Direct vs Gateway connection modes](https://learn.microsoft.com/azure/cosmos-db/nosql/sdk-connection-modes)
