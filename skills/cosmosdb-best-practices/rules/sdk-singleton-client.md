---
title: Reuse CosmosClient as Singleton
impact: CRITICAL
impactDescription: prevents connection exhaustion
tags: sdk, singleton, connection, performance
---

## Reuse CosmosClient as Singleton

Create CosmosClient once and reuse it throughout the application lifetime. Creating multiple clients exhausts connections and wastes resources.

**Incorrect (creating new client per request):**

```csharp
// Anti-pattern: New client per operation
public class OrderRepository
{
    public async Task<Order> GetOrder(string orderId, string customerId)
    {
        // WRONG: Creates new client every call!
        using var cosmosClient = new CosmosClient(connectionString);
        var container = cosmosClient.GetContainer("db", "orders");
        return await container.ReadItemAsync<Order>(orderId, new PartitionKey(customerId));
    }
    // Client disposed = connection closed
    // Next call = new connection = TCP handshake + TLS negotiation
}

// Results in:
// - Connection exhaustion under load
// - High latency (connection setup per request)
// - Memory leaks (connection pool not reused)
// - Eventually: SocketException or timeout errors
```

**Correct (singleton client):**

```csharp
// Register as singleton in DI
public static class ServiceCollectionExtensions
{
    public static IServiceCollection AddCosmosDb(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        services.AddSingleton<CosmosClient>(sp =>
        {
            var connectionString = configuration["CosmosDb:ConnectionString"];
            
            return new CosmosClient(connectionString, new CosmosClientOptions
            {
                ApplicationName = "MyApp",
                ConnectionMode = ConnectionMode.Direct,
                MaxRetryAttemptsOnRateLimitedRequests = 9,
                MaxRetryWaitTimeOnRateLimitedRequests = TimeSpan.FromSeconds(30)
            });
        });
        
        services.AddSingleton<IOrderRepository, OrderRepository>();
        
        return services;
    }
}

// Repository uses injected singleton client
public class OrderRepository : IOrderRepository
{
    private readonly Container _container;
    
    public OrderRepository(CosmosClient cosmosClient)
    {
        _container = cosmosClient.GetContainer("db", "orders");
    }
    
    public async Task<Order> GetOrder(string orderId, string customerId)
    {
        return await _container.ReadItemAsync<Order>(
            orderId, 
            new PartitionKey(customerId));
    }
}
```

```csharp
// For Azure Functions (using static initialization)
public static class CosmosDbFunction
{
    private static readonly Lazy<CosmosClient> _lazyClient = new(() =>
    {
        var connectionString = Environment.GetEnvironmentVariable("CosmosDbConnection");
        return new CosmosClient(connectionString);
    });
    
    private static CosmosClient Client => _lazyClient.Value;
    
    [FunctionName("GetOrder")]
    public static async Task<IActionResult> GetOrder(
        [HttpTrigger(AuthorizationLevel.Function, "get")] HttpRequest req)
    {
        var container = Client.GetContainer("db", "orders");
        // Client reused across all function invocations
    }
}
```

```csharp
// Graceful shutdown (optional but recommended)
public class CosmosDbHostedService : IHostedService
{
    private readonly CosmosClient _client;
    
    public CosmosDbHostedService(CosmosClient client) => _client = client;
    
    public Task StartAsync(CancellationToken cancellationToken) => Task.CompletedTask;
    
    public async Task StopAsync(CancellationToken cancellationToken)
    {
        _client.Dispose();
    }
}
```

Reference: [CosmosClient best practices](https://learn.microsoft.com/azure/cosmos-db/nosql/best-practice-dotnet)
