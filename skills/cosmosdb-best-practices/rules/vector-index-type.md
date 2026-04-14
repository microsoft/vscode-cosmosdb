---
title: Configure Vector Indexes in Indexing Policy
impact: CRITICAL
impactDescription: Required for vector search performance
tags: vector, index, quantizedflat, diskann, performance
---

## Configure Vector Indexes in Indexing Policy

**Impact: CRITICAL (Required for vector search performance)**

Vector indexes must be added to the indexing policy to enable efficient vector similarity search. Choose between QuantizedFlat (faster builds, good for smaller datasets) or DiskANN (better for larger datasets, requires more memory).

**Vector Index Types:**
- `QuantizedFlat`: Quantized flat index - faster to build, good for datasets < 50K vectors
- `DiskANN`: Disk-based approximate nearest neighbor - better for larger datasets, optimized for scale

**CRITICAL: Exclude vector paths from regular indexing** to avoid high RU charges and latency on inserts.

**Incorrect (no vector indexes or missing excludedPaths):**

```csharp
// .NET - Missing vector indexes
var properties = new ContainerProperties("documents", "/category")
{
    VectorEmbeddingPolicy = new(embeddings)
};
// No VectorIndexes configured!
```

```python
# Python - Missing excluded paths for vectors
indexing_policy = { 
    "includedPaths": [{"path": "/*"}],
    "vectorIndexes": [
        {"path": "/embedding", "type": "quantizedFlat"}
    ]
    # Missing excludedPaths - will cause high RU consumption!
}
```

**Correct (with vector indexes and excluded paths):**

```csharp
// .NET - SDK 3.45.0+
ContainerProperties properties = new ContainerProperties(
    id: "documents", 
    partitionKeyPath: "/category")
{   
    VectorEmbeddingPolicy = new(collection),
    IndexingPolicy = new IndexingPolicy()
    {
        VectorIndexes = new()
        {
            new VectorIndexPath()
            {
                Path = "/embedding",
                Type = VectorIndexType.QuantizedFlat,
            }
        }
    },
};

// CRITICAL: Exclude vector paths from regular indexing
properties.IndexingPolicy.IncludedPaths.Add(new IncludedPath { Path = "/*" });
properties.IndexingPolicy.ExcludedPaths.Add(new ExcludedPath { Path = "/embedding/*" });
```

```python
# Python
indexing_policy = { 
    "includedPaths": [{"path": "/*"}], 
    "excludedPaths": [
        {"path": "/\"_etag\"/?"},
        {"path": "/embedding/*"}  # CRITICAL: Exclude vector path
    ], 
    "vectorIndexes": [
        {
            "path": "/embedding", 
            "type": "quantizedFlat"  # or "diskANN" for larger datasets
        }
    ] 
}

container = db.create_container_if_not_exists( 
    id="documents", 
    partition_key=PartitionKey(path='/category'), 
    indexing_policy=indexing_policy, 
    vector_embedding_policy=vector_embedding_policy
)
```

```javascript
// JavaScript - SDK 4.1.0+
const indexingPolicy = {
  vectorIndexes: [
    { path: "/embedding", type: VectorIndexType.QuantizedFlat }
  ],
  includedPaths: [{ path: "/*" }],
  excludedPaths: [
    { path: "/embedding/*" }  // CRITICAL: Exclude vector path
  ]
};

const { resource: containerdef } = await database.containers.createIfNotExists({
  id: "documents",
  partitionKey: { paths: ["/category"] },
  vectorEmbeddingPolicy: vectorEmbeddingPolicy,
  indexingPolicy: indexingPolicy
});
```

```java
// Java
IndexingPolicy indexingPolicy = new IndexingPolicy();
indexingPolicy.setIndexingMode(IndexingMode.CONSISTENT);

// CRITICAL: Exclude vector path
ExcludedPath excludedPath = new ExcludedPath("/embedding/*");
indexingPolicy.setExcludedPaths(Collections.singletonList(excludedPath));

IncludedPath includedPath = new IncludedPath("/*");
indexingPolicy.setIncludedPaths(Collections.singletonList(includedPath));

// Vector index configuration
CosmosVectorIndexSpec vectorIndexSpec = new CosmosVectorIndexSpec();
vectorIndexSpec.setPath("/embedding");
vectorIndexSpec.setType(CosmosVectorIndexType.QUANTIZED_FLAT.toString());

indexingPolicy.setVectorIndexes(Collections.singletonList(vectorIndexSpec));

containerProperties.setIndexingPolicy(indexingPolicy);
database.createContainer(containerProperties).block();
```

**Index Type Selection Guide:**
- Use `QuantizedFlat` for: < 50K vectors, faster builds, lower memory
- Use `DiskANN` for: > 50K vectors, better recall, production workloads

Reference: [.NET](https://learn.microsoft.com/en-us/azure/cosmos-db/how-to-dotnet-vector-index-query#create-a-vector-index-in-the-indexing-policy) | [Python](https://learn.microsoft.com/en-us/azure/cosmos-db/how-to-python-vector-index-query#create-a-vector-index-in-the-indexing-policy) | [JavaScript](https://learn.microsoft.com/en-us/azure/cosmos-db/how-to-javascript-vector-index-query#create-a-vector-index-in-the-indexing-policy) | [Java](https://learn.microsoft.com/en-us/azure/cosmos-db/how-to-java-vector-index-query#create-a-vector-index-in-the-indexing-policy)
