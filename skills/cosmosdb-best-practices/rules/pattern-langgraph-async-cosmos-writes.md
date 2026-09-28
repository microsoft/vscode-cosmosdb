---
title: Use asyncio.to_thread for Active Agent Writes in LangGraph Node Functions
impact: HIGH
impactDescription: prevents event loop blocking during Cosmos DB upserts in async node functions
tags: pattern, langgraph, async, cosmos-db, writes, multi-agent
---

## Use asyncio.to_thread for Active Agent Writes in LangGraph Node Functions

**Impact: HIGH (prevents event loop blocking during Cosmos DB upserts in async node functions)**

When saving the active agent after a transfer (inside a LangGraph node function), using the sync Cosmos DB SDK also blocks the event loop. Node functions in LangGraph run as coroutines. Wrap synchronous write operations in `asyncio.to_thread()` to keep the event loop responsive.

**Incorrect (synchronous upsert blocks the event loop inside an async node):**

```python
async def call_agent(state, config):
    response = await agent.ainvoke(state)
    # BAD: Blocks the event loop during upsert
    container.upsert_item({
        "id": thread_id,
        "sessionId": thread_id,
        "activeAgent": "target_agent",
    })
    return Command(update=response, goto="target_agent")
```

**Correct (non-blocking write with asyncio.to_thread):**

```python
import asyncio
import logging

logger = logging.getLogger(__name__)

async def save_active_agent_to_db_async(
    thread_id: str, agent_name: str, tenant_id: str, user_id: str
):
    """Non-blocking upsert of active agent to Cosmos DB."""
    def _save():
        try:
            container = get_sync_container("ChatSessions")
            container.upsert_item({
                "id": thread_id,
                "sessionId": thread_id,
                "tenantId": tenant_id,
                "userId": user_id,
                "activeAgent": agent_name,
            })
        except Exception as e:
            logger.error(f"Failed to save active agent: {e}")
    await asyncio.to_thread(_save)

async def call_agent(state, config):
    response = await agent.ainvoke(state)
    thread_id = config.get("configurable", {}).get("thread_id", "")
    tenant_id = config.get("configurable", {}).get("tenantId", "")
    user_id = config.get("configurable", {}).get("userId", "")
    # Non-blocking write — errors logged but not propagated
    await save_active_agent_to_db_async(thread_id, "target_agent", tenant_id, user_id)
    return Command(update=response, goto="target_agent")
```

**Key points:**
1. Wrap all synchronous Cosmos DB write operations in `asyncio.to_thread()` inside async node functions
2. Writes can be fire-and-forget — errors are logged but not propagated, since failing to persist the active agent is not fatal to the current request
3. Keep the synchronous logic in a nested helper function for clarity and thread-safety
4. Use `upsert_item` (not `create_item`) to handle both new and existing sessions

Reference: [Python asyncio.to_thread documentation](https://docs.python.org/3/library/asyncio-task.html#asyncio.to_thread)
