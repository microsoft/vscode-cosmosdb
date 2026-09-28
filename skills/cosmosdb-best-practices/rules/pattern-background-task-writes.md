---
title: Use Background Tasks for Non-Blocking Chat History Storage
impact: MEDIUM
impactDescription: reduces API response latency by 50-200ms per request
tags: pattern, fastapi, cosmos-db, background-tasks, latency
---

## Use Background Tasks for Non-Blocking Chat History Storage

**Impact: MEDIUM (reduces API response latency by 50-200ms per request)**

After a LangGraph agent produces a response, storing chat history and debug logs in Cosmos DB is important for the UI but not for the immediate API response. Use FastAPI's `BackgroundTasks` to defer these writes, returning the agent response to the user immediately. This avoids adding Cosmos DB write latency (typically 5-20ms per write, more with multiple writes) to the user-facing response time.

**Incorrect (blocking writes before returning response):**

```python
from fastapi import FastAPI

@app.post("/chat/{session_id}")
async def chat(session_id: str, user_message: str):
    response = await graph.ainvoke(state, config, stream_mode="updates")
    messages = extract_response(response)

    # BAD: User waits for all these DB writes to complete before seeing the response
    for msg in messages:
        store_chat_history(msg)  # 5-20ms each
    store_debug_log(session_id, response)  # Another 10-20ms
    update_active_agent(session_id, last_agent)  # Another 5-10ms

    return messages  # User waited an extra 50-200ms unnecessarily
```

**Correct (defer writes with BackgroundTasks):**

```python
from fastapi import FastAPI, BackgroundTasks

def process_post_response(messages, session_id, tenant_id, user_id, active_agent):
    """Runs after the response is sent to the client."""
    for msg in messages:
        store_chat_history(msg)
    update_active_agent_in_latest_message(session_id, active_agent)

@app.post("/chat/{session_id}")
async def chat(
    session_id: str,
    user_message: str,
    background_tasks: BackgroundTasks
):
    response = await graph.ainvoke(state, config, stream_mode="updates")
    messages = extract_response(response)

    # Schedule writes to run after the response is sent
    background_tasks.add_task(
        process_post_response, messages, session_id, tenant_id, user_id, active_agent
    )

    # Response returned immediately — user sees it while writes happen in background
    return messages
```

**When to use background tasks vs. blocking:**
- **Background:** Chat history storage, debug log writes, session name updates, analytics
- **Blocking:** Active agent patch (if needed for the *current* response routing), session creation, critical state that the next request depends on

**Note:** Background tasks in FastAPI run in the same process after the response. For truly fire-and-forget workloads at scale, consider Azure Cosmos DB change feed triggers or message queues.

Reference: [FastAPI Background Tasks](https://fastapi.tiangolo.com/tutorial/background-tasks/)
