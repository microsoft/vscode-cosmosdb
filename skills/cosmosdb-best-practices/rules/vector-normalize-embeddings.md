---
title: Normalize Embeddings for Cosine Similarity
impact: MEDIUM
impactDescription: Ensures accurate similarity scores and consistent test results
tags: vector, embeddings, normalization, testing, cosine
---

## Normalize Embeddings for Cosine Similarity

**Impact: MEDIUM (Accurate similarity scores)**

When using cosine distance (the most common choice for vector search), normalize embeddings to unit length (L2 norm = 1). This ensures consistent similarity scores and enables accurate testing with mock embeddings.

**Why Normalize:**
- Cosine similarity measures the angle between vectors, not magnitude
- Unnormalized embeddings can produce inconsistent scores
- Most embedding models (Azure OpenAI, etc.) return normalized vectors
- Essential for generating mock embeddings for testing

**Formula:**
```
normalized_vector = vector / ||vector||₂
where ||vector||₂ = sqrt(sum(x² for x in vector))
```

**Incorrect (unnormalized embeddings):**

```python
# Python - BAD: Random vectors without normalization
import random

def generate_mock_embedding(dimensions=1536):
    # Returns unnormalized random vector
    return [random.uniform(-1, 1) for _ in range(dimensions)]
    # Problem: Magnitude varies, affects cosine similarity scores
```

```csharp
// .NET - BAD: Unnormalized test embeddings
public float[] GenerateMockEmbedding(int dimensions = 1536)
{
    var random = new Random();
    var embedding = new float[dimensions];
    for (int i = 0; i < dimensions; i++)
    {
        embedding[i] = (float)(random.NextDouble() * 2 - 1);
    }
    return embedding; // Not normalized - scores will be inconsistent
}
```

**Correct (normalized to unit length):**

```python
# Python - GOOD: Normalized embeddings
import numpy as np

def generate_mock_embedding(text: str, dimensions: int = 1536) -> list:
    """
    Generate normalized mock embedding for testing.
    Uses text hash as seed for reproducibility.
    """
    # Use text hash as seed for deterministic results
    seed = hash(text) % (2**32)
    np.random.seed(seed)
    
    # Generate random vector
    vector = np.random.randn(dimensions).astype(np.float32)
    
    # Normalize to unit length (critical for cosine similarity)
    vector = vector / np.linalg.norm(vector)
    
    return vector.tolist()

# Verify normalization
embedding = generate_mock_embedding("test document")
magnitude = np.linalg.norm(embedding)
assert abs(magnitude - 1.0) < 1e-6, f"Not normalized: {magnitude}"

# Use in tests
documents = [
    {
        "id": "doc1",
        "content": "Azure Cosmos DB vector search",
        "embedding": generate_mock_embedding("Azure Cosmos DB vector search")
    }
]
```

```csharp
// .NET - GOOD: Normalized embeddings
using System;
using System.Linq;

public class EmbeddingHelper
{
    public static float[] GenerateMockEmbedding(string text, int dimensions = 1536)
    {
        // Use text hash as seed for reproducibility
        var seed = Math.Abs(text.GetHashCode());
        var random = new Random(seed);
        
        // Generate random vector
        var vector = new float[dimensions];
        for (int i = 0; i < dimensions; i++)
        {
            // Box-Muller transform for normal distribution
            double u1 = random.NextDouble();
            double u2 = random.NextDouble();
            vector[i] = (float)(Math.Sqrt(-2.0 * Math.Log(u1)) * Math.Cos(2.0 * Math.PI * u2));
        }
        
        // Normalize to unit length (L2 norm = 1)
        var magnitude = Math.Sqrt(vector.Sum(x => x * x));
        for (int i = 0; i < dimensions; i++)
        {
            vector[i] /= (float)magnitude;
        }
        
        return vector;
    }
    
    public static double CalculateMagnitude(float[] vector)
    {
        return Math.Sqrt(vector.Sum(x => x * x));
    }
}

// Usage
var embedding = EmbeddingHelper.GenerateMockEmbedding("test document");
var magnitude = EmbeddingHelper.CalculateMagnitude(embedding);
Console.WriteLine($"Magnitude: {magnitude}"); // Should be ~1.0

var document = new Document
{
    Id = "doc1",
    Content = "Azure Cosmos DB",
    Embedding = embedding
};
```

```javascript
// JavaScript - GOOD: Normalized embeddings
function generateMockEmbedding(text, dimensions = 1536) {
    // Simple hash for seed
    let seed = 0;
    for (let i = 0; i < text.length; i++) {
        seed = ((seed << 5) - seed) + text.charCodeAt(i);
        seed = seed & seed; // Convert to 32-bit integer
    }
    
    // Seeded random number generator
    const random = (function(seed) {
        let state = seed;
        return function() {
            state = (state * 1103515245 + 12345) & 0x7fffffff;
            return state / 0x7fffffff;
        };
    })(Math.abs(seed));
    
    // Generate random vector with normal distribution (Box-Muller)
    const vector = [];
    for (let i = 0; i < dimensions; i++) {
        const u1 = random();
        const u2 = random();
        const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        vector.push(z);
    }
    
    // Normalize to unit length
    const magnitude = Math.sqrt(vector.reduce((sum, x) => sum + x * x, 0));
    return vector.map(x => x / magnitude);
}

// Verify
const embedding = generateMockEmbedding("test document");
const magnitude = Math.sqrt(embedding.reduce((sum, x) => sum + x * x, 0));
console.log(`Magnitude: ${magnitude}`); // Should be ~1.0

const document = {
    id: "doc1",
    content: "Azure Cosmos DB",
    embedding: embedding
};
```

```java
// Java - GOOD: Normalized embeddings
import java.util.Random;

public class EmbeddingHelper {
    public static float[] generateMockEmbedding(String text, int dimensions) {
        // Use text hash as seed for reproducibility
        int seed = Math.abs(text.hashCode());
        Random random = new Random(seed);
        
        // Generate random vector with normal distribution
        float[] vector = new float[dimensions];
        for (int i = 0; i < dimensions; i++) {
            vector[i] = (float) random.nextGaussian();
        }
        
        // Normalize to unit length
        double magnitude = 0.0;
        for (float v : vector) {
            magnitude += v * v;
        }
        magnitude = Math.sqrt(magnitude);
        
        for (int i = 0; i < dimensions; i++) {
            vector[i] /= magnitude;
        }
        
        return vector;
    }
    
    public static double calculateMagnitude(float[] vector) {
        double sum = 0.0;
        for (float v : vector) {
            sum += v * v;
        }
        return Math.sqrt(sum);
    }
}

// Usage
float[] embedding = EmbeddingHelper.generateMockEmbedding("test document", 1536);
double magnitude = EmbeddingHelper.calculateMagnitude(embedding);
System.out.println("Magnitude: " + magnitude); // Should be ~1.0
```

**Production Embeddings:**

Most embedding APIs return normalized vectors automatically, but verify:

```python
# Azure OpenAI - typically normalized
from openai import AzureOpenAI

client = AzureOpenAI(...)
response = client.embeddings.create(
    input="search query",
    model="text-embedding-ada-002"
)
embedding = response.data[0].embedding

# Verify normalization (optional, for debugging)
import numpy as np
magnitude = np.linalg.norm(embedding)
print(f"Magnitude: {magnitude}")  # Should be ~1.0

# If not normalized (rare), normalize:
if abs(magnitude - 1.0) > 0.01:
    embedding = (np.array(embedding) / magnitude).tolist()
```

**Testing Best Practices:**

1. **Deterministic Mock Embeddings** - Use text/content hash as random seed
   ```python
   seed = hash(text) % (2**32)  # Reproducible results
   ```

2. **Verify Normalization** - Assert magnitude is ~1.0 in tests
   ```python
   assert abs(np.linalg.norm(embedding) - 1.0) < 1e-6
   ```

3. **Realistic Dimensions** - Use actual dimensions (1536 for Ada-002, 3072 for text-embedding-3-large)

4. **Similarity Score Ranges** - With normalized vectors and cosine distance:
   - Identical vectors: score = 1.0
   - Orthogonal vectors: score = 0.0
   - Opposite vectors: score = -1.0 (rare in embeddings)

**When NOT to Normalize:**

- If using **Euclidean** or **Dot Product** distance functions (check your embedding policy)
- When magnitude carries semantic meaning (very rare)
- If embedding model explicitly states vectors are not normalized

**Common Mistake:**

```python
# BAD: Comparing normalized query to unnormalized documents
query_embedding = normalize(get_embedding(query))  # Normalized
documents = [
    {"embedding": [random.random() for _ in range(1536)]}  # NOT normalized
]
# Results: Inconsistent similarity scores
```

**Related Rules:**
- vector-embedding-policy.md - Choose cosine distance function
- vector-distance-query.md - VectorDistance() queries return similarity scores
