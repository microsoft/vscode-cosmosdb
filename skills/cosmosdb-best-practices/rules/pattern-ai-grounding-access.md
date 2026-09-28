---
title: Use Point Reads for AI-Grounding and RAG Retrieval When ID Is Known
impact: HIGH
impactDescription: 1 RU point read vs ~2.5+ RU query per grounding fetch; reduces tool-call latency in LLM loops
tags: pattern, ai, grounding, rag, point-read, tool-call, llm, retrieval
---

## Use Point Reads for AI-Grounding and RAG Retrieval When ID Is Known

In AI-grounded workloads an LLM tool-use loop typically resolves a concrete entity id (e.g., `orderId`, `sessionId`, `documentId`) from the user turn or tool-call arguments, then fetches the full document from Cosmos DB to build the grounding context for the model. Because the id and partition key are both known at call time, a point read should always be used instead of a query. This applies to any retrieval step that feeds data into an LLM context window — RAG retrieval, tool-call handlers, grounding functions, or agent data-fetching steps.

**How to recognize this pattern — static tell-tales:**

- An LLM / AI client import in the same module (e.g., `OpenAI`, `AzureOpenAI`, `ChatCompletionClient`, Semantic Kernel, LangChain)
- A function that parses tool-call arguments or assembles a `messages` array
- A Cosmos DB call using a single-id equality filter where the id was extracted from user input or a tool-call response

**Incorrect (query when id and partition key are both available from the tool call):**

```typescript
// ❌ Generic query — id is already known from the user turn / tool call
export async function groundOrderContext(orderId: string, userId: string) {
  const { resources: orders } = await ordersContainer.items
    .query<Order>({
      query: "SELECT * FROM c WHERE c.orderId = @o",
      parameters: [{ name: "@o", value: orderId }],
    })
    .fetchAll();

  const { resources: events } = await eventsContainer.items
    .query<DeliveryEvent>({
      query: "SELECT * FROM c WHERE c.orderId = @o ORDER BY c.timestamp DESC",
      parameters: [{ name: "@o", value: orderId }],
    })
    .fetchAll();

  return buildGroundingContext(orders[0], events);
}
```

```python
# ❌ Query instead of point read — id and partition key both known
def ground_order_context(order_id: str, user_id: str):
    orders = list(orders_container.query_items(
        query="SELECT * FROM c WHERE c.id = @id",
        parameters=[{"name": "@id", "value": order_id}],
        partition_key=user_id,
    ))
    return build_grounding_context(orders[0]) if orders else None
```

**Correct (point read for the primary document, partition-scoped projection for related items):**

```typescript
// ✅ Point read for the order (id + partition key both known from tool call)
export async function groundOrderContext(orderId: string, userId: string) {
  const orderResp = await ordersContainer.item(orderId, userId).read<Order>();
  const order = orderResp.resource;
  if (!order) return null;

  // ✅ Partition-key-scoped projection for related event list
  const { resources: events } = await eventsContainer.items
    .query<DeliveryEvent>(
      {
        query:
          "SELECT c.id, c.orderId, c.timestamp, c.status, c.note FROM c WHERE c.orderId = @o ORDER BY c.timestamp DESC",
        parameters: [{ name: "@o", value: orderId }],
      },
      { partitionKey: orderId }
    )
    .fetchAll();

  return buildGroundingContext(order, events);
}
```

```python
# ✅ Point read — 1 RU, no query engine overhead
def ground_order_context(order_id: str, user_id: str):
    order = orders_container.read_item(item=order_id, partition_key=user_id)
    return build_grounding_context(order)
```

**Why this matters for AI workloads:**

1. **Latency-sensitive** — each tool call adds to perceived LLM response time; a point read (1 RU, single backend hop) is the fastest possible retrieval
2. **Throughput-sensitive** — hot conversations drive the same partition key repeatedly; cross-partition fan-out under load hot-spots a single logical partition fastest
3. **ID is known by construction** — the LLM tool-use loop hands the agent an id parsed from the user turn or a prior tool result; agents should recognise this signal and reach for the point read

See also: `query-point-reads` (general point-read guidance), `query-use-projections` (select only needed fields), `query-avoid-cross-partition` (avoid cross-partition fan-out).

Reference: [Request Units — point reads cost fewer RUs than queries](https://learn.microsoft.com/azure/cosmos-db/request-units#request-unit-considerations)
