---
title: Define Vector Embedding Policy
impact: CRITICAL
impactDescription: Required for vector search functionality
tags: vector, embedding, configuration, ai, rag
---

## Define Vector Embedding Policy

**Impact: CRITICAL (Required for vector search functionality)**

The vector embedding policy provides essential information to the Azure Cosmos DB query engine about how to handle vector properties in the VectorDistance system functions. This policy is required and cannot be modified after container creation.

**Vector Embedding Policy Properties:**
- `path`: The property path that contains vectors (e.g., `/embedding`, `/contentVector`)
- `dataType`: The type of the elements of the vector (default: Float32)
- `dimensions`: The length of each vector in the path (default: 1536)
- `distanceFunction`: The metric used to compute distance/similarity (default: Cosine, options: Cosine, DotProduct, Euclidean)

**Incorrect (no vector embedding policy):**

```csharp
// .NET - Missing vector embedding policy
var containerProperties = new ContainerProperties("mycontainer", "/partitionKey");
await database.CreateContainerAsync(containerProperties);
```

```python
# Python - Missing vector embedding policy
container = db.create_container(
    id="mycontainer",
    partition_key=PartitionKey(path='/id')
)
```

**Correct (with vector embedding policy):**

```csharp
// .NET - SDK 3.45.0+
List<Embedding> embeddings = new List<Embedding>()
{
    new Embedding()
    {
        Path = "/embedding",
        DataType = VectorDataType.Float32,
        DistanceFunction = DistanceFunction.Cosine,
        Dimensions = 1536,
    }
};

Collection<Embedding> collection = new Collection<Embedding>(embeddings);
ContainerProperties properties = new ContainerProperties(
    id: "documents", 
    partitionKeyPath: "/category")
{   
    VectorEmbeddingPolicy = new(collection)
};
```

```python
# Python
vector_embedding_policy = { 
    "vectorEmbeddings": [ 
        { 
            "path": "/embedding", 
            "dataType": "float32", 
            "distanceFunction": "cosine", 
            "dimensions": 1536
        }
    ]    
}

container = db.create_container_if_not_exists( 
    id="documents", 
    partition_key=PartitionKey(path='/category'), 
    vector_embedding_policy=vector_embedding_policy
)
```

```javascript
// JavaScript - SDK 4.1.0+
const vectorEmbeddingPolicy = {
  vectorEmbeddings: [
    {
      path: "/embedding",
      dataType: VectorEmbeddingDataType.Float32,
      dimensions: 1536,
      distanceFunction: VectorEmbeddingDistanceFunction.Cosine,
    }
  ],
};

const { resource: containerdef } = await database.containers.createIfNotExists({
  id: "documents",
  partitionKey: { paths: ["/category"] },
  vectorEmbeddingPolicy: vectorEmbeddingPolicy
});
```

```java
// Java
CosmosVectorEmbeddingPolicy cosmosVectorEmbeddingPolicy = new CosmosVectorEmbeddingPolicy();

CosmosVectorEmbedding embedding = new CosmosVectorEmbedding();
embedding.setPath("/embedding");
embedding.setDataType(CosmosVectorDataType.FLOAT32);
embedding.setDimensions(1536L);
embedding.setDistanceFunction(CosmosVectorDistanceFunction.COSINE);

cosmosVectorEmbeddingPolicy.setCosmosVectorEmbeddings(Arrays.asList(embedding));

CosmosContainerProperties containerProperties = new CosmosContainerProperties("documents", "/category");
containerProperties.setVectorEmbeddingPolicy(cosmosVectorEmbeddingPolicy);

database.createContainer(containerProperties).block();
```

Reference: [.NET](https://learn.microsoft.com/en-us/azure/cosmos-db/how-to-dotnet-vector-index-query) | [Python](https://learn.microsoft.com/en-us/azure/cosmos-db/how-to-python-vector-index-query) | [JavaScript](https://learn.microsoft.com/en-us/azure/cosmos-db/how-to-javascript-vector-index-query) | [Java](https://learn.microsoft.com/en-us/azure/cosmos-db/how-to-java-vector-index-query)
