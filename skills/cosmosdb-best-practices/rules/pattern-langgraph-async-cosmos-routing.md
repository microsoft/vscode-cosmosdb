---
title: Wrap Cosmos DB Sync Calls in asyncio.to_thread for LangGraph Routing Functions
impact: CRITICAL
impactDescription: prevents event loop blocking that causes all concurrent requests to hang
tags: pattern, langgraph, async, cosmos-db, routing, multi-agent
---

## Wrap Cosmos DB Sync Calls in asyncio.to_thread for LangGraph Routing Functions

**Impact: CRITICAL (prevents event loop blocking that causes all concurrent requests to hang)**

LangGraph's `add_conditional_edges` routing function runs inside the async event loop. If the routing function calls `DefaultAzureCredential` or `container.read_item()` synchronously, it blocks the entire event loop — causing all concurrent requests to hang and potentially triggering timeouts. Always wrap synchronous Cosmos DB SDK calls in `asyncio.to_thread()` and add a timeout to prevent hung routing if Cosmos DB is slow or unreachable.

**Incorrect (synchronous Cosmos DB call blocks the event loop):**

```python
from azure.cosmos import CosmosClient

def get_active_agent(state, config) -> str:
    thread_id = config["configurable"]["thread_id"]
    # BAD: Blocks the event loop when called from LangGraph's async runtime
    item = container.read_item(item=thread_id, partition_key=thread_id)
    active_agent = item.get("activeAgent", "unknown")
    if active_agent not in [None, "unknown", "coordinator"]:
        return active_agent
    return "coordinator"
```

**Correct (async wrapper with timeout and fallback):**

```python
import asyncio
from azure.cosmos import CosmosClient

def _read_active_agent_from_db(thread_id: str) -> str:
    """Synchronous helper — runs in a thread pool."""
    container = get_sync_container("ChatSessions")
    item = container.read_item(item=thread_id, partition_key=thread_id)
    return item.get("activeAgent", "unknown")

async def get_active_agent_from_db(thread_id: str) -> str:
    """Non-blocking wrapper with timeout for reading active agent from Cosmos DB."""
    try:
        return await asyncio.wait_for(
            asyncio.to_thread(_read_active_agent_from_db, thread_id),
            timeout=5.0,
        )
    except Exception:
        # Covers: CosmosResourceNotFoundError (new session),
        # asyncio.TimeoutError (cold start / slow DB),
        # CredentialUnavailableError (auth not ready)
        return "unknown"

async def get_active_agent(state, config) -> str:
    """Routing function for add_conditional_edges — must be async def."""
    thread_id = config.get("configurable", {}).get("thread_id", "")
    active_agent = await get_active_agent_from_db(thread_id)
    if active_agent not in [None, "unknown", "coordinator"]:
        return active_agent
    return "coordinator"
```

**Key points:**
1. The routing function MUST be `async def` when using Cosmos DB lookups
2. Always wrap `DefaultAzureCredential` and `read_item()` in `asyncio.to_thread()`
3. Add a timeout (5s) to prevent hung routing if Cosmos DB is slow or unreachable
4. Fall back to "coordinator" on any exception — never let a DB failure crash the graph
5. The routing function must NEVER raise — it runs on every single message as a graph entry point

Reference: [Python asyncio.to_thread documentation](https://docs.python.org/3/library/asyncio-task.html#asyncio.to_thread)
