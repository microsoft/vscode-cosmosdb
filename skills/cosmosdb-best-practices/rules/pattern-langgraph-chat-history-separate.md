---
title: Store Chat History Separately from LangGraph Checkpoints
impact: MEDIUM
impactDescription: enables efficient message retrieval and agent attribution
tags: pattern, cosmos-db, chat-history, checkpointing, multi-agent
---

## Store Chat History Separately from LangGraph Checkpoints

**Impact: MEDIUM (enables efficient message retrieval and agent attribution)**

LangGraph's checkpointer (CosmosDBSaver) stores full graph state for resumption, but it is not optimized for retrieving displayable chat history. Checkpoint data contains internal graph metadata, tool messages, system messages, and duplicate entries from each node execution. Instead, maintain a separate Cosmos DB container for chat history with only the fields your UI needs (sender, text, timestamp, which agent responded). This enables efficient queries, proper agent attribution, and avoids scanning checkpoint blobs.

**Incorrect (reading chat history from the checkpointer store):**

```python
@app.get("/sessions/{session_id}/messages")
async def get_messages(session_id: str):
    config = {"configurable": {"thread_id": session_id, "checkpoint_ns": ""}}
    # BAD: Checkpointer stores ALL graph state — tool messages, system messages,
    # intermediate states, duplicates from each node. Expensive to scan and filter.
    checkpoints = [cp async for cp in checkpointer.alist(config)]
    if not checkpoints:
        return []
    
    # Must dig into checkpoint internals to extract displayable messages
    messages = checkpoints[-1].checkpoint["channel_values"]["messages"]
    # No record of which agent responded — lost in checkpoint format
    return filter_displayable(messages)
```

**Correct (store displayable history in a dedicated container):**

```python
from azure.cosmos import CosmosClient

# Dedicated container with partition key /sessionId for efficient retrieval
history_container = database.get_container_client("ChatHistory")

def store_chat_message(session_id: str, tenant_id: str, user_id: str, 
                       sender: str, text: str, agent_name: str):
    """Store a single displayable message after graph execution completes."""
    history_container.create_item({
        "id": str(uuid.uuid4()),
        "sessionId": session_id,
        "tenantId": tenant_id,
        "userId": user_id,
        "sender": sender,
        "agentName": agent_name,  # Which agent responded — not available in checkpoints
        "text": text,
        "timestamp": datetime.utcnow().isoformat(),
    })

@app.get("/sessions/{session_id}/messages")
def get_messages(session_id: str):
    # Single-partition query — fast and cheap (few RUs)
    return list(history_container.query_items(
        query="SELECT * FROM c WHERE c.sessionId = @sid ORDER BY c.timestamp",
        parameters=[{"name": "@sid", "value": session_id}],
        partition_key=session_id
    ))
```

**Why separate storage:**
1. **Agent attribution** — checkpoints don't track which agent produced each response
2. **Query efficiency** — dedicated container with `/sessionId` partition key enables single-partition queries
3. **Cleaner data** — no tool messages, system messages, or graph internal state
4. **Independent scaling** — chat history access patterns differ from checkpointing (read-heavy vs. write-heavy)

Reference: [Azure Cosmos DB container design](https://learn.microsoft.com/azure/cosmos-db/nosql/how-to-model-partition-example)
