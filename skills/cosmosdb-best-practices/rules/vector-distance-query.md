---
title: Use VectorDistance for Similarity Search
impact: HIGH
impactDescription: Enables semantic search and RAG patterns
tags: vector, query, vectordistance, similarity, rag
---

## Use VectorDistance for Similarity Search

**Impact: HIGH (Enables semantic search and RAG patterns)**

Use the VectorDistance() system function to perform vector similarity searches. This function computes the distance between a query vector and stored vectors using the distance function specified in the vector embedding policy.

**Query Pattern:**
```sql
SELECT TOP N c.property, VectorDistance(c.vectorPath, @embedding) AS SimilarityScore
FROM c
ORDER BY VectorDistance(c.vectorPath, @embedding)
```

**Incorrect (missing ORDER BY or parameterization):**

```csharp
// .NET - Not parameterized, no ORDER BY
var query = "SELECT c.title FROM c WHERE VectorDistance(c.embedding, [0.1, 0.2, ...]) < 0.5";
// Issues: 
// 1. Hard-coded embedding array (query plan cache misses)
// 2. No ORDER BY (doesn't return most similar first)
// 3. Using WHERE instead of ORDER BY (less efficient)
```

```python
# Python - Missing TOP/LIMIT
query = "SELECT c.title, VectorDistance(c.embedding, @embedding) AS score FROM c"
# Missing ORDER BY and TOP - returns all items unsorted
```

**Correct (parameterized with ORDER BY):**

```csharp
// .NET - SDK 3.45.0+
float[] queryEmbedding = await GetEmbeddingAsync("search query");

var queryDef = new QueryDefinition(
    query: "SELECT TOP 10 c.title, VectorDistance(c.embedding, @embedding) AS SimilarityScore " +
           "FROM c ORDER BY VectorDistance(c.embedding, @embedding)"
).WithParameter("@embedding", queryEmbedding);

using FeedIterator<SearchResult> feed = container.GetItemQueryIterator<SearchResult>(
    queryDefinition: queryDef
);

while (feed.HasMoreResults) 
{
    FeedResponse<SearchResult> response = await feed.ReadNextAsync();
    foreach (var item in response)
    {
        Console.WriteLine($"{item.Title}: {item.SimilarityScore}");
    }
}
```

```python
# Python
query_embedding = get_embedding("search query")  # Returns list of floats

for item in container.query_items( 
    query='SELECT TOP 10 c.title, VectorDistance(c.embedding, @embedding) AS SimilarityScore ' +
          'FROM c ORDER BY VectorDistance(c.embedding, @embedding)', 
    parameters=[
        {"name": "@embedding", "value": query_embedding}
    ], 
    enable_cross_partition_query=True
):
    print(f"{item['title']}: {item['SimilarityScore']}")
```

```javascript
// JavaScript - SDK 4.1.0+
const queryEmbedding = await getEmbedding("search query");

const { resources } = await container.items
  .query({
    query: "SELECT TOP 10 c.title, VectorDistance(c.embedding, @embedding) AS SimilarityScore " +
           "FROM c ORDER BY VectorDistance(c.embedding, @embedding)",
    parameters: [{ name: "@embedding", value: queryEmbedding }]
  })
  .fetchAll();

for (const item of resources) {
  console.log(`${item.title}: ${item.SimilarityScore}`);
}
```

```java
// Java
float[] queryEmbedding = getEmbedding("search query");

ArrayList<SqlParameter> paramList = new ArrayList<>();
paramList.add(new SqlParameter("@embedding", queryEmbedding));

SqlQuerySpec querySpec = new SqlQuerySpec(
    "SELECT TOP 10 c.title, VectorDistance(c.embedding, @embedding) AS SimilarityScore " +
    "FROM c ORDER BY VectorDistance(c.embedding, @embedding)", 
    paramList
);

CosmosPagedIterable<SearchResult> results = container.queryItems(
    querySpec, 
    new CosmosQueryRequestOptions(), 
    SearchResult.class
);

for (SearchResult result : results) {
    System.out.println(result.getTitle() + ": " + result.getSimilarityScore());
}
```

**Best Practices:**
- Always use `@parameters` for embeddings (enables query plan caching)
- Include `ORDER BY VectorDistance()` to get most similar results first
- Use `TOP N` to limit results (reduces RU consumption)
- Consider combining with WHERE clauses for filtered vector search
- Enable cross-partition queries when partition key is not in WHERE clause

**Hybrid Search Example (Vector + Filters):**
```sql
SELECT TOP 10 c.title, VectorDistance(c.embedding, @embedding) AS score
FROM c
WHERE c.category = @category AND c.publishYear >= @minYear
ORDER BY VectorDistance(c.embedding, @embedding)
```

Reference: [VectorDistance](https://learn.microsoft.com/en-us/cosmos-db/query/vectordistance) | [.NET](https://learn.microsoft.com/en-us/azure/cosmos-db/how-to-dotnet-vector-index-query#run-a-vector-similarity-search-query) | [Python](https://learn.microsoft.com/en-us/azure/cosmos-db/how-to-python-vector-index-query#run-a-vector-similarity-search-query) | [JavaScript](https://learn.microsoft.com/en-us/azure/cosmos-db/how-to-javascript-vector-index-query#run-a-vector-similarity-search-query) | [Java](https://learn.microsoft.com/en-us/azure/cosmos-db/how-to-java-vector-index-query#run-a-vector-similarity-search-query)
