---
title: Use dependent @Bean methods for Cosmos DB initialization in Spring Boot
impact: HIGH
impactDescription: prevents circular dependency, startup failures, class name collisions, and compile errors
tags: sdk, java, spring-boot, configuration, cosmos-config, bean, postconstruct, AbstractCosmosConfiguration
---

## Use Dependent @Bean Methods for Cosmos DB Initialization in Spring Boot

When configuring `CosmosClient`, `CosmosDatabase`, and `CosmosContainer` beans in a Spring Boot `@Configuration` class, use dependent `@Bean` methods with parameter injection instead of `@PostConstruct`. Calling a `@Bean` method from `@PostConstruct` in the same class creates a circular dependency that crashes the application on startup.

Follow these additional rules to avoid common startup failures:

1. **Do not name your configuration class `CosmosConfig`.** This collides with `com.azure.spring.data.cosmos.config.CosmosConfig` in the Spring Data Cosmos SDK, causing cascading compile errors. Use `CosmosDbConfig`, `CosmosConfiguration`, or `AppCosmosConfig` instead.

2. **Always call `createDatabaseIfNotExists()` before `createContainerIfNotExists()`.** On a fresh Cosmos DB instance (including the emulator), the database does not exist. Calling `createContainerIfNotExists()` without first ensuring the database exists throws `CosmosException: NotFound`.

3. **When extending `AbstractCosmosConfiguration`, do not annotate `cosmosClientBuilder()` with `@Override`.** It is not declared as overridable in `AbstractCosmosConfiguration`. Provide it as a `@Bean` method instead. The only method you should override is `getDatabaseName()`.

**Incorrect (@PostConstruct calling @Bean — circular dependency):**

```java
// ❌ Anti-pattern: @PostConstruct + @Bean in same class causes circular dependency
@Configuration
public class CosmosDbConfig {

    @Value("${azure.cosmos.endpoint}")
    private String endpoint;

    @Value("${azure.cosmos.key}")
    private String key;

    @Bean
    public CosmosClient cosmosClient() {
        return new CosmosClientBuilder()
            .endpoint(endpoint)
            .key(key)
            .consistencyLevel(ConsistencyLevel.SESSION)
            .buildClient();
    }

    @PostConstruct  // ❌ This calls cosmosClient() which is a @Bean — circular!
    public void initializeDatabase() {
        CosmosClient client = cosmosClient(); // Triggers proxy interception loop
        client.createDatabaseIfNotExists("mydb");
        CosmosDatabase db = client.getDatabase("mydb");
        db.createContainerIfNotExists(
            new CosmosContainerProperties("items", "/partitionKey"),
            ThroughputProperties.createAutoscaledThroughput(4000));
    }

    @Bean
    public CosmosDatabase cosmosDatabase() {
        return cosmosClient().getDatabase("mydb");
    }

    @Bean
    public CosmosContainer cosmosContainer() {
        return cosmosDatabase().getContainer("items");
    }
}
// Runtime error: BeanCurrentlyInCreationException — circular dependency detected
```

**Correct (dependent @Bean chain with parameter injection):**

```java
// ✅ Correct: Use @Bean dependency injection chain — initialization in bean methods
@Configuration
public class CosmosDbConfig {

    @Value("${azure.cosmos.endpoint}")
    private String endpoint;

    @Value("${azure.cosmos.key}")
    private String key;

    @Value("${azure.cosmos.database}")
    private String databaseName;

    @Value("${azure.cosmos.container}")
    private String containerName;

    @Bean(destroyMethod = "close")
    public CosmosClient cosmosClient() {
        DirectConnectionConfig directConfig = DirectConnectionConfig.getDefaultConfig();
        GatewayConnectionConfig gatewayConfig = GatewayConnectionConfig.getDefaultConfig();

        // Use Gateway for emulator, Direct for production
        CosmosClientBuilder builder = new CosmosClientBuilder()
            .endpoint(endpoint)
            .key(key)
            .consistencyLevel(ConsistencyLevel.SESSION)
            .contentResponseOnWriteEnabled(true);

        if (endpoint.contains("localhost") || endpoint.contains("127.0.0.1")) {
            builder.gatewayMode(gatewayConfig);
        } else {
            builder.directMode(directConfig);
        }

        return builder.buildClient();
    }

    @Bean  // ✅ Spring injects cosmosClient from the bean above
    public CosmosDatabase cosmosDatabase(CosmosClient cosmosClient) {
        // Database initialization happens here — no @PostConstruct needed
        cosmosClient.createDatabaseIfNotExists(databaseName);
        return cosmosClient.getDatabase(databaseName);
    }

    @Bean  // ✅ Spring injects cosmosDatabase from the bean above
    public CosmosContainer cosmosContainer(CosmosDatabase cosmosDatabase) {
        CosmosContainerProperties props = new CosmosContainerProperties(
            containerName, "/partitionKey");

        cosmosDatabase.createContainerIfNotExists(
            props,
            ThroughputProperties.createAutoscaledThroughput(4000));

        return cosmosDatabase.getContainer(containerName);
    }
}
```

**Why this works:**
- Spring resolves the dependency graph: `cosmosClient()` → `cosmosDatabase(CosmosClient)` → `cosmosContainer(CosmosDatabase)`
- Database and container creation happens naturally during bean initialization
- No circular reference because each method receives its dependency as a parameter
- `destroyMethod = "close"` ensures `CosmosClient` is properly shut down

**With Hierarchical Partition Keys:**

```java
@Bean
public CosmosContainer cosmosContainer(CosmosDatabase cosmosDatabase) {
    // Hierarchical partition key definition
    List<String> partitionKeyPaths = Arrays.asList(
        "/tenantId", "/type", "/projectId");

    CosmosContainerProperties props = new CosmosContainerProperties(
        containerName,
        partitionKeyPaths,
        PartitionKeyDefinitionVersion.V2,
        PartitionKind.MULTI_HASH);

    cosmosDatabase.createContainerIfNotExists(
        props,
        ThroughputProperties.createAutoscaledThroughput(4000));

    return cosmosDatabase.getContainer(containerName);
}
```

**Alternative: `SmartInitializingSingleton` for post-init logic:**

```java
// If you need to run logic AFTER all beans are created
@Bean
public SmartInitializingSingleton cosmosInitializer(CosmosContainer container) {
    return () -> {
        // Seed data, verify connectivity, warm up, etc.
        logger.info("Cosmos container ready: {}", container.getId());
    };
}
```

**Common mistake: Missing `createDatabaseIfNotExists()` before container creation:**

```java
// ❌ Crashes on a fresh Cosmos DB instance — database doesn't exist yet
@EventListener(ApplicationReadyEvent.class)
public void initializeCosmosDb() {
    CosmosAsyncClient client = cosmosAsyncClient();
    CosmosAsyncDatabase db = client.getDatabase(databaseName);
    db.createContainerIfNotExists(containerName,
        "/partitionKey").block();  // CosmosException: Database not found
}
```

```java
// ✅ Always create the database first
@EventListener(ApplicationReadyEvent.class)
public void initializeCosmosDb() {
    CosmosAsyncClient client = cosmosAsyncClient();
    client.createDatabaseIfNotExists(databaseName).block();  // ← required
    CosmosAsyncDatabase db = client.getDatabase(databaseName);
    db.createContainerIfNotExists(containerName,
        "/partitionKey").block();
}
```

**When extending `AbstractCosmosConfiguration`:**

```java
// ❌ cosmosClientBuilder() is not overridable — compile error
@Configuration
@EnableCosmosRepositories
public class CosmosDbConfig extends AbstractCosmosConfiguration {

    @Override  // ❌ "method does not override or implement a method from a supertype"
    public CosmosClientBuilder cosmosClientBuilder() {
        return new CosmosClientBuilder()
            .endpoint(endpoint)
            .key(key);
    }

    @Override
    protected String getDatabaseName() {
        return databaseName;
    }
}
```

```java
// ✅ Provide cosmosClientBuilder() as a @Bean, only override getDatabaseName()
@Configuration
@EnableCosmosRepositories
public class CosmosDbConfig extends AbstractCosmosConfiguration {

    @Bean  // ✅ Not an override — declare as a bean
    public CosmosClientBuilder cosmosClientBuilder() {
        return new CosmosClientBuilder()
            .endpoint(endpoint)
            .key(key)
            .consistencyLevel(ConsistencyLevel.SESSION)
            .contentResponseOnWriteEnabled(true);
    }

    @Override  // ✅ getDatabaseName() is the only overridable method
    protected String getDatabaseName() {
        return databaseName;
    }
}
```

**Key Points:**
- Never call `@Bean` methods from `@PostConstruct` in the same `@Configuration` class
- Use parameter injection in `@Bean` methods to express initialization order
- Always set `destroyMethod = "close"` on `CosmosClient` bean
- Keep `CosmosClient` as a singleton `@Bean` (Rule 4.16)
- Set `contentResponseOnWriteEnabled(true)` in the builder (Rule 4.9)
- Do not name your configuration class `CosmosConfig` — it collides with `com.azure.spring.data.cosmos.config.CosmosConfig`
- Always call `createDatabaseIfNotExists()` before `createContainerIfNotExists()`
- When extending `AbstractCosmosConfiguration`, use `@Bean` (not `@Override`) on `cosmosClientBuilder()`

References:
- [Spring Framework @Bean documentation](https://docs.spring.io/spring-framework/reference/core/beans/java/bean-annotation.html)
- [`CosmosAsyncClient.createDatabaseIfNotExists()` Javadoc](https://learn.microsoft.com/java/api/com.azure.cosmos.cosmosasyncclient?view=azure-java-stable)
- [`AbstractCosmosConfiguration` Javadoc](https://learn.microsoft.com/java/api/com.azure.spring.data.cosmos.config.abstractcosmosconfiguration?view=azure-java-stable)
