---
title: Resume LangGraph from Checkpoint After Interrupt
impact: HIGH
impactDescription: enables multi-turn conversations with persistent state
tags: pattern, langgraph, fastapi, checkpointing, resume
---

## Resume LangGraph from Checkpoint After Interrupt

**Impact: HIGH (enables multi-turn conversations with persistent state)**

When a LangGraph graph pauses at an `interrupt()` node, the next user message must resume from the last checkpoint rather than starting fresh. Retrieve the last checkpoint, append the new user message, inject `langgraph_triggers` to signal which node to resume, and call `ainvoke` with `stream_mode="updates"`. Without proper resume logic, each message starts a new conversation with no memory of prior turns.

**Incorrect (always starts a fresh graph invocation):**

```python
@app.post("/chat/{session_id}")
async def chat(session_id: str, user_message: str):
    config = {"configurable": {"thread_id": session_id}}
    # BAD: Always starts from scratch — ignores prior conversation state
    state = {"messages": [{"role": "user", "content": user_message}]}
    response = await graph.ainvoke(state, config, stream_mode="updates")
    return extract_response(response)
```

**Correct (resume from last checkpoint when one exists):**

```python
@app.post("/chat/{session_id}")
async def chat(session_id: str, user_message: str):
    config = {"configurable": {"thread_id": session_id, "checkpoint_ns": ""}}

    # Check for existing checkpoint (prior conversation state)
    checkpoints = [cp async for cp in checkpointer.alist(config)]

    if not checkpoints:
        # First message — start fresh
        state = {"messages": [{"role": "user", "content": user_message}]}
    else:
        # Resume from last checkpoint
        last_checkpoint = checkpoints[-1]
        state = last_checkpoint.checkpoint

        if "messages" not in state:
            state["messages"] = []
        state["messages"].append({"role": "user", "content": user_message})

        # Signal which node to resume from (required after interrupt)
        # Determine the last active agent from channel_versions or external state
        resume_node = determine_resume_node(state)
        state["langgraph_triggers"] = [f"resume:{resume_node}"]

    response = await graph.ainvoke(state, config, stream_mode="updates")
    return extract_response(response)
```

**Key details:**
1. `stream_mode="updates"` returns per-node state diffs, making it easy to extract only the final agent response
2. `langgraph_triggers` tells the graph which paused node to resume — without it, the graph may restart from START
3. The `checkpoint_ns` must match what was used when the checkpoint was written (typically `""`)
4. Use `checkpointer.alist(config)` to list checkpoints — this is an async generator

Reference: [LangGraph persistence](https://langchain-ai.github.io/langgraph/concepts/persistence/)
