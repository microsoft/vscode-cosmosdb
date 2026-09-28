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

**`CosmosClient` is synchronously disposable only (.NET).** `CosmosClient` implements `IDisposable`, **not** `IAsyncDisposable`. There is no `DisposeAsync()` method. Any wrapper or context type that holds a `CosmosClient` must implement `IDisposable` and call `Dispose()` — never `IAsyncDisposable` / `DisposeAsync()`.

**Incorrect (IAsyncDisposable — causes CS1061):**

```csharp
// WRONG: CosmosClient does not implement IAsyncDisposable
public sealed class CosmosDbContext : IAsyncDisposable
{
    private readonly CosmosClient _client;
    public CosmosDbContext(string connectionString)
        => _client = new CosmosClient(connectionString);
    // CS1061: 'CosmosClient' does not contain a definition for 'DisposeAsync'
    public ValueTask DisposeAsync() => _client.DisposeAsync();
}
```

**Correct (IDisposable):**

```csharp
// RIGHT: Use IDisposable — CosmosClient.Dispose() exists
public sealed class CosmosDbContext : IDisposable
{
    private readonly CosmosClient _client;
    public CosmosDbContext(string connectionString)
        => _client = new CosmosClient(connectionString);
    public void Dispose() => _client.Dispose();
}
```

```rust
// Rust (azure_data_cosmos): Singleton via Arc shared across async handlers
use azure_data_cosmos::{
    CosmosAccountEndpoint, CosmosAccountReference, CosmosClient, CosmosClientBuilder,
};
use azure_core::credentials::Secret;
use std::sync::Arc;

pub type SharedCosmos = Arc<CosmosClient>;

async fn create_singleton_client(endpoint: &str, key: &str) -> SharedCosmos {
    let endpoint: CosmosAccountEndpoint = endpoint.parse().expect("valid endpoint");
    let account = CosmosAccountReference::with_master_key(
        endpoint,
        Secret::from(key.to_string()),
    );
    let client = CosmosClientBuilder::new()
        .build(account)
        .await
        .expect("build client");
    Arc::new(client)
}

// Share the Arc<CosmosClient> via Axum state
#[tokio::main]
async fn main() {
    let cosmos = create_singleton_client("https://...", "key...").await;
    let app = axum::Router::new()
        .route("/orders", axum::routing::get(list_orders))
        .with_state(cosmos); // Single client reused by all handlers
    // ...
}

async fn list_orders(
    axum::extract::State(cosmos): axum::extract::State<SharedCosmos>,
) -> impl axum::response::IntoResponse {
    let container = cosmos.database_client("db").container_client("orders").await;
    // Use container...
    axum::http::StatusCode::OK
}
```

Reference: [CosmosClient best practices](https://learn.microsoft.com/azure/cosmos-db/nosql/best-practice-dotnet)
