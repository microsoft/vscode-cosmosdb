---
title: Implement Repository Pattern for Vector Search
impact: HIGH
impactDescription: Provides clean abstraction for vector operations and data access
tags: vector, repository, pattern, architecture, vector-search
---

## Implement Repository Pattern for Vector Search

**Impact: HIGH (Clean abstraction for vector operations)**

When implementing vector search, use a repository pattern to encapsulate Cosmos DB operations. This separates data access logic from business logic and makes vector search operations testable and maintainable.

**Key Methods to Implement:**
1. **insert_document/upsert_document** - Store documents with embeddings
2. **vector_search** - Perform similarity search with VectorDistance()
3. **get_document** - Point read by ID and partition key
4. **delete_document** - Remove documents

**Incorrect (direct container access in application code):**

```python
# Python - BAD: Direct container access scattered throughout app
@app.post("/api/search")
async def search(request: SearchRequest):
    # Vector search logic mixed with API logic
    query = f"""
        SELECT TOP {request.limit} c.title, 
               VectorDistance(c.embedding, @embedding) AS score
        FROM c ORDER BY VectorDistance(c.embedding, @embedding)
    """
    results = container.query_items(query, parameters=[...])
    # No abstraction, hard to test, tightly coupled
```

```csharp
// .NET - BAD: No separation of concerns
public class DocumentService {
    public async Task<List<Doc>> Search(float[] embedding) {
        // Direct container access, no abstraction
        var query = new QueryDefinition(...);
        var iterator = _container.GetItemQueryIterator<Doc>(query);
        // Mixing infrastructure concerns with business logic
    }
}
```

**Correct (repository pattern with clean abstraction):**

```python
# Python - GOOD: Repository pattern
class DocumentRepository:
    """Repository for documents with vector search capabilities"""
    
    def __init__(self, container: ContainerProxy):
        self.container = container
    
    async def insert_document(self, document: DocumentChunk) -> DocumentChunk:
        """Insert document with vector embedding."""
        try:
            doc_dict = document.dict()
            created_item = self.container.upsert_item(body=doc_dict)
            return DocumentChunk(**created_item)
        except CosmosHttpResponseError as e:
            logger.error(f"Failed to insert document: {e.message}")
            raise
    
    async def vector_search(
        self,
        query_embedding: List[float],
        limit: int = 5,
        similarity_threshold: float = 0.0,
        category_filter: Optional[str] = None
    ) -> List[DocumentChunk]:
        """Perform vector similarity search with VectorDistance()."""
        try:
            # Build parameterized query
            query = """
                SELECT TOP @limit 
                    c.id, c.title, c.content, c.category, c.metadata,
                    VectorDistance(c.embedding, @queryVector) AS similarityScore
                FROM c
                WHERE VectorDistance(c.embedding, @queryVector) > @threshold
            """
            
            # Add optional filters
            if category_filter:
                query += " AND c.category = @category"
            
            query += " ORDER BY VectorDistance(c.embedding, @queryVector)"
            
            # Build parameters
            parameters = [
                {"name": "@queryVector", "value": query_embedding},
                {"name": "@limit", "value": limit},
                {"name": "@threshold", "value": similarity_threshold}
            ]
            
            if category_filter:
                parameters.append({"name": "@category", "value": category_filter})
            
            # Execute query
            items = list(self.container.query_items(
                query=query,
                parameters=parameters,
                enable_cross_partition_query=True,
                populate_query_metrics=True
            ))
            
            # Convert to domain models
            results = []
            for item in items:
                score = item.pop('similarityScore', 0.0)
                if 'metadata' not in item:
                    item['metadata'] = {}
                item['metadata']['similarityScore'] = score
                item['embedding'] = []  # Exclude from response for performance
                results.append(DocumentChunk(**item))
            
            return results
            
        except CosmosHttpResponseError as e:
            logger.error(f"Vector search failed: {e.message}")
            raise
    
    async def get_document(self, document_id: str, category: str) -> Optional[DocumentChunk]:
        """Point read with partition key."""
        try:
            item = self.container.read_item(
                item=document_id,
                partition_key=category
            )
            return DocumentChunk(**item)
        except CosmosHttpResponseError as e:
            if e.status_code == 404:
                return None
            raise

# Usage in application
@app.post("/api/search")
async def search(request: SearchRequest):
    results = await document_repo.vector_search(
        query_embedding=request.embedding,
        limit=request.top_k,
        category_filter=request.category
    )
    return {"results": results}
```

```csharp
// .NET - GOOD: Repository pattern
public interface IDocumentRepository
{
    Task<DocumentChunk> InsertDocumentAsync(DocumentChunk document);
    Task<List<DocumentChunk>> VectorSearchAsync(
        float[] queryEmbedding, 
        int limit = 5, 
        double similarityThreshold = 0.0, 
        string? categoryFilter = null);
    Task<DocumentChunk?> GetDocumentAsync(string id, string category);
}

public class DocumentRepository : IDocumentRepository
{
    private readonly Container _container;
    private readonly ILogger<DocumentRepository> _logger;

    public DocumentRepository(Container container, ILogger<DocumentRepository> logger)
    {
        _container = container;
        _logger = logger;
    }

    public async Task<DocumentChunk> InsertDocumentAsync(DocumentChunk document)
    {
        try
        {
            var response = await _container.UpsertItemAsync(
                item: document,
                partitionKey: new PartitionKey(document.Category)
            );
            _logger.LogInformation("Inserted document {Id}", document.Id);
            return response.Resource;
        }
        catch (CosmosException ex)
        {
            _logger.LogError(ex, "Failed to insert document {Id}", document.Id);
            throw;
        }
    }

    public async Task<List<DocumentChunk>> VectorSearchAsync(
        float[] queryEmbedding, 
        int limit = 5,
        double similarityThreshold = 0.0, 
        string? categoryFilter = null)
    {
        try
        {
            // Build query
            var queryText = @"
                SELECT TOP @limit 
                    c.id, c.title, c.content, c.category, c.metadata,
                    VectorDistance(c.embedding, @queryVector) AS similarityScore
                FROM c
                WHERE VectorDistance(c.embedding, @queryVector) > @threshold";

            if (!string.IsNullOrEmpty(categoryFilter))
            {
                queryText += " AND c.category = @category";
            }

            queryText += " ORDER BY VectorDistance(c.embedding, @queryVector)";

            // Build query definition
            var queryDef = new QueryDefinition(queryText)
                .WithParameter("@queryVector", queryEmbedding)
                .WithParameter("@limit", limit)
                .WithParameter("@threshold", similarityThreshold);

            if (!string.IsNullOrEmpty(categoryFilter))
            {
                queryDef = queryDef.WithParameter("@category", categoryFilter);
            }

            // Execute query
            var results = new List<DocumentChunk>();
            using var iterator = _container.GetItemQueryIterator<DocumentChunk>(queryDef);

            while (iterator.HasMoreResults)
            {
                var response = await iterator.ReadNextAsync();
                results.AddRange(response);
                
                // Log RU consumption
                _logger.LogDebug("Vector search consumed {RU} RUs", 
                    response.RequestCharge);
            }

            return results;
        }
        catch (CosmosException ex)
        {
            _logger.LogError(ex, "Vector search failed");
            throw;
        }
    }

    public async Task<DocumentChunk?> GetDocumentAsync(string id, string category)
    {
        try
        {
            var response = await _container.ReadItemAsync<DocumentChunk>(
                id: id,
                partitionKey: new PartitionKey(category)
            );
            return response.Resource;
        }
        catch (CosmosException ex) when (ex.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            return null;
        }
    }
}

// Usage in service/controller
public class SearchService
{
    private readonly IDocumentRepository _repository;

    public SearchService(IDocumentRepository repository)
    {
        _repository = repository;
    }

    public async Task<List<DocumentChunk>> SearchAsync(SearchRequest request)
    {
        return await _repository.VectorSearchAsync(
            queryEmbedding: request.Embedding,
            limit: request.TopK,
            categoryFilter: request.Category
        );
    }
}
```

```javascript
// JavaScript/TypeScript - GOOD: Repository pattern
class DocumentRepository {
    constructor(private container: Container) {}

    async insertDocument(document: DocumentChunk): Promise<DocumentChunk> {
        try {
            const { resource } = await this.container.items.upsert(document);
            console.log(`Inserted document ${resource.id}`);
            return resource;
        } catch (error) {
            console.error('Failed to insert document:', error);
            throw error;
        }
    }

    async vectorSearch(
        queryEmbedding: number[],
        options: {
            limit?: number;
            similarityThreshold?: number;
            categoryFilter?: string;
        } = {}
    ): Promise<DocumentChunk[]> {
        const { limit = 5, similarityThreshold = 0.0, categoryFilter } = options;

        try {
            let query = `
                SELECT TOP @limit 
                    c.id, c.title, c.content, c.category, c.metadata,
                    VectorDistance(c.embedding, @queryVector) AS similarityScore
                FROM c
                WHERE VectorDistance(c.embedding, @queryVector) > @threshold
            `;

            const parameters = [
                { name: '@queryVector', value: queryEmbedding },
                { name: '@limit', value: limit },
                { name: '@threshold', value: similarityThreshold }
            ];

            if (categoryFilter) {
                query += ' AND c.category = @category';
                parameters.push({ name: '@category', value: categoryFilter });
            }

            query += ' ORDER BY VectorDistance(c.embedding, @queryVector)';

            const { resources } = await this.container.items
                .query({
                    query,
                    parameters
                })
                .fetchAll();

            return resources.map(item => ({
                ...item,
                embedding: [] // Exclude for performance
            }));
        } catch (error) {
            console.error('Vector search failed:', error);
            throw error;
        }
    }

    async getDocument(id: string, category: string): Promise<DocumentChunk | null> {
        try {
            const { resource } = await this.container.item(id, category).read();
            return resource;
        } catch (error: any) {
            if (error.code === 404) {
                return null;
            }
            throw error;
        }
    }
}

// Usage
const documentRepo = new DocumentRepository(container);
const results = await documentRepo.vectorSearch(embedding, { 
    limit: 10, 
    categoryFilter: 'ai' 
});
```

**Benefits:**
- ✅ Testable - Mock repository in unit tests
- ✅ Maintainable - Vector search logic in one place
- ✅ Reusable - Use repository across multiple services
- ✅ Clean separation - Infrastructure vs business logic
- ✅ Easier to optimize - Centralized query performance tuning

**Best Practices:**
1. Use `upsert_item` for idempotent inserts
2. Always parameterize queries (never concatenate embeddings)
3. Include `ORDER BY VectorDistance()` for ranked results
4. Exclude embeddings from SELECT when not needed (performance)
5. Log RU consumption for monitoring
6. Handle 404 errors gracefully (return null, not exception)
7. Use domain models (not raw dictionaries/dynamic)

**Related Rules:**
- vector-distance-query.md - VectorDistance() usage
- query-parameterize.md - Always use parameters
- query-use-projections.md - Exclude unnecessary fields
