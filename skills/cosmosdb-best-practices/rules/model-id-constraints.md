---
title: Follow ID Value Length and Character Constraints
impact: HIGH
impactDescription: prevents write failures, 401 auth errors, and cross-SDK interoperability issues
tags: model, id, limits, interoperability, design, auth, url-reserved
---

## Follow ID Value Length and Character Constraints

Azure Cosmos DB enforces a **1,023 byte** maximum for the `id` property and restricts certain characters. Using URL-reserved or path-separator characters in `id` values causes authentication failures (401) or routing errors (404) that are difficult to diagnose because they only surface on read/update/delete — not on create.

### URL-reserved characters break Cosmos DB auth signing

Cosmos DB's REST protocol computes an HMAC signature over a canonical string that includes the ResourceLink (`dbs/{db}/colls/{coll}/docs/{id}`). When the SDK sends an HTTP request whose URL embeds a URL-reserved character in the `id` segment, the HTTP transport may strip or reinterpret the URL (e.g. a `#` is a fragment delimiter per RFC 3986 and is removed before the request leaves the client). The server then recomputes the signature over the truncated ResourceLink and returns **401 Unauthorized: "The input authorization token can't serve the request"** — even though the key is correct.

The failure surfaces on `read_item`, `replace_item`, `delete_item`, and `patch_item`. It does **not** surface on `create_item` (the id is not part of the signed ResourceLink for creates — the parent collection is), so the bug often hides until the first update or read.

This is a cross-SDK issue affecting any SDK using Gateway mode. The Python SDK uses Gateway mode by default and always hits this. The .NET SDK hits the same failure in Gateway mode but not in Direct mode (Direct bypasses HTTP URI parsing). The .NET SDK's own test suite (`CosmosItemIdEncodingTestsBase.cs`, test `IdWithDisallowedCharPoundSign`) confirms 401 on read/replace/delete in Gateway mode with `#` in the id.

**Never use any of these in `id`:**

| Char | Reason |
|------|--------|
| `#` | URL fragment delimiter — HTTP client strips everything after `#` before sending; server sees truncated id, HMAC signature mismatch → 401 |
| `?` | URL query delimiter — same truncation class of failure → 401 |
| `/` `\` | Path separators — change the ResourceLink structure → 404 or 400 |

**Avoid (interoperability / encoding risk):**

| Char | Reason |
|------|--------|
| ` ` (space) | Percent-encoding inconsistency across SDKs and connectors |
| `%` | Ambiguous with percent-encoding sequences |
| Any non-ASCII | Encoded differently across clients; known issues in ADF / Spark / Kafka connectors |

**Safe synthetic-id separators:** `_`, `-`, `:`

### The `id` property is always a string

Azure Cosmos DB stores and indexes the `id` system property as a JSON string. There is no numeric `id` type.

When migrating from a relational database, keep the primary-key value but store it as a string `id` value:

| Relational key | Cosmos DB `id` |
|---------------|---------------|
| `42` | `"42"` |
| `90001` | `"90001"` |

Bind `id` to a string type in DTOs, domain models, and API contracts.

**Incorrect:**

```csharp
public record Product(int Id, string Name);
```

**Correct:**

```csharp
public record Product(string Id, string Name);
```

### SQL to NoSQL migration guidance

Do not introduce a parallel numeric copy of `id` solely for sorting or pagination.

**Incorrect:**

```sql
SELECT * FROM c
ORDER BY c.idNum
```

**Correct (for string ordering by id):**

```sql
SELECT * FROM c
ORDER BY c.id
```

If numeric ordering is required, use a dedicated business field such as `sku`, `sequenceNumber`, or another domain-specific numeric property:

```sql
SELECT * FROM c
ORDER BY c.sequenceNumber
```

Do not introduce a numeric shadow copy of `id` solely for sorting or pagination.

| Symptom | Cause |
|----------|--------|
| Could not convert `$.id` to `Int32` | DTO binds `id` to a numeric type |
| Unexpected pagination ordering | Sorting by a numeric shadow id instead of `c.id` |

**Incorrect (oversized or problematic IDs):**

```csharp
// Anti-pattern 1: ID derived from unbounded user input
public class Document
{
    // ID could exceed 1,023 bytes if title is very long
    public string Id => $"{Category}_{SubCategory}_{Title}_{Description}";
    public string Category { get; set; }
    public string SubCategory { get; set; }
    public string Title { get; set; }
    public string Description { get; set; }  // Unbounded!
}

// Anti-pattern 2: IDs containing forbidden or problematic characters
var doc = new Document
{
    Id = "files/reports\\2026/Q1",  // Contains '/' and '\' - FORBIDDEN
    Content = "..."
};
await container.CreateItemAsync(doc);
// Fails or causes routing issues

// Anti-pattern 3: Non-ASCII characters in IDs
var doc2 = new Document
{
    Id = "レポート_2026_データ",  // Non-ASCII - interoperability risk
    Content = "..."
};
// Works in some SDKs but may break in ADF, Spark, Kafka connectors
```

```python
# Anti-pattern 4: Using '#' as composite-id separator — 401 on read/update/delete
doc_id = f"best#{player_id}#{week}#{region}"
await container.upsert_item(body={"id": doc_id, ...})   # succeeds (create)
await container.read_item(item=doc_id, partition_key=pk) # 💥 401 Unauthorized
```

**Correct (safe, bounded IDs):**

```csharp
// Use GUIDs or short alphanumeric identifiers
public class Document
{
    public string Id { get; set; }
    public string Category { get; set; }
    public string Title { get; set; }
}

// Option 1: GUID-based IDs (always safe, always unique)
var doc = new Document
{
    Id = Guid.NewGuid().ToString(),  // "a1b2c3d4-e5f6-..."
    Category = "reports",
    Title = "Q1 Report"
};

// Option 2: Compact, deterministic IDs from business keys
var doc2 = new Document
{
    Id = $"report-{tenantId}-{DateTime.UtcNow:yyyyMMdd}-{sequenceNum}",
    Category = "reports",
    Title = "Q1 Report"
};

// Option 3: Base64-encode when you must derive from non-ASCII data
var rawId = "レポート_2026_データ";
var doc3 = new Document
{
    Id = Convert.ToBase64String(Encoding.UTF8.GetBytes(rawId))
            .Replace('/', '_').Replace('+', '-'),  // URL-safe Base64
    Category = "reports",
    Title = rawId  // Keep original value as a property
};
```

```python
# Correct: Use ':' or '_' or '-' as composite-id separators
doc_id = f"best:{player_id}:{week}:{region}"   # ✅ works on all operations
await container.upsert_item(body={"id": doc_id, ...})
await container.read_item(item=doc_id, partition_key=pk)  # ✅ 200 OK
```

Key constraints:
- **Max length:** 1,023 bytes
- **Forbidden characters:** `#`, `?`, `/`, and `\` are not allowed — `#` and `?` cause 401 Unauthorized on read/update/delete; `/` and `\` cause routing failures
- **Best practice:** Use only alphanumeric ASCII characters (`a-z`, `A-Z`, `0-9`, `-`, `_`) and `:` as a separator
- **Why:** URL-reserved characters break REST auth signing across all SDKs in Gateway mode; some SDK versions, Azure Data Factory, Spark connector, and Kafka connector have additional issues with non-alphanumeric IDs
- Encode non-ASCII IDs with Base64 + custom encoding if needed for interoperability

See also: `partition-synthetic-keys` for synthetic-key construction patterns.

Reference: [Azure Cosmos DB service quotas - Per-item limits](https://learn.microsoft.com/azure/cosmos-db/concepts-limits#per-item-limits) | [Access control on Cosmos DB resources](https://learn.microsoft.com/rest/api/cosmos-db/access-control-on-cosmosdb-resources)
