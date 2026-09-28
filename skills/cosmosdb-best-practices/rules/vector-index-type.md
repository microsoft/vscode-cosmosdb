---
title: Configure Vector Indexes in Indexing Policy
impact: CRITICAL
impactDescription: Required for vector search performance
tags: vector, index, flat, quantizedflat, diskann, performance
---

## Configure Vector Indexes in Indexing Policy

**Impact: CRITICAL (Required for vector search performance)**

Vector indexes must be added to the indexing policy to enable efficient vector similarity search. Choose an index from the required recall, vector dimensions, and number of vectors scoped to each important query after partition-key and filter predicates. Do not choose from the total container size alone.

**Vector Index Types:**
- `flat`: Exact brute-force search with 100% recall. Use for exact search over small, focused candidate sets subject to the documented [505-dimension service limit](https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/vector-search#vector-indexing-policies).
- `quantizedFlat`: Brute-force search over compressed vectors. It supports up to 4,096 dimensions and is a good starting point when filters or partition scope leave 50,000 or fewer vectors per search. Quantization can introduce a small loss of accuracy.
- `diskANN`: Approximate nearest-neighbor search that supports up to 4,096 dimensions. It generally provides the best latency, throughput, and RU efficiency when important queries span more than 50,000 vectors, but it doesn't guarantee exact or deterministic top-K results.

`quantizedFlat` and `diskANN` [require at least 1,000 indexed vectors](https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/vector-search#vector-indexing-policies) before Cosmos DB uses the vector index. With fewer vectors, the query uses a full scan. This activation threshold is separate from the 50,000-vector selection guideline, which applies to the candidate set scoped to an individual search.

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
            "type": "quantizedFlat"  # or "diskANN" for broader query scopes
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

**Index Type Selection Workflow:**
1. If the workload requires exact top-K results, use `flat` when the vectors satisfy the `flat` dimension limit above and the scoped candidate set is small enough for the workload's latency and RU targets.
2. If compressed or approximate results are acceptable, estimate the vectors remaining after the partition key and filters used by each important query:
    - Start with `quantizedFlat` when the scoped search has 50,000 or fewer vectors.
    - Start with `diskANN` when the scoped search has more than 50,000 vectors.
3. Test the choice with representative embeddings from the production model. Random vectors don't reproduce the geometry or recall behavior of real embeddings.
4. Measure recall, latency, throughput, and RU consumption instead of treating 50,000 as a hard cutoff. For `diskANN`, increase `searchListSizeMultiplier` in `VectorDistance` when higher recall is worth additional latency and RU cost.
5. Keep the vector path in `vectorIndexes` and exclude it from the regular index regardless of the selected vector index type.

Reference: [Vector indexing policies](https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/vector-search#vector-indexing-policies) | [.NET](https://learn.microsoft.com/en-us/azure/cosmos-db/how-to-dotnet-vector-index-query#create-a-vector-index-in-the-indexing-policy) | [Python](https://learn.microsoft.com/en-us/azure/cosmos-db/how-to-python-vector-index-query#create-a-vector-index-in-the-indexing-policy) | [JavaScript](https://learn.microsoft.com/en-us/azure/cosmos-db/how-to-javascript-vector-index-query#create-a-vector-index-in-the-indexing-policy) | [Java](https://learn.microsoft.com/en-us/azure/cosmos-db/how-to-java-vector-index-query#create-a-vector-index-in-the-indexing-policy)
