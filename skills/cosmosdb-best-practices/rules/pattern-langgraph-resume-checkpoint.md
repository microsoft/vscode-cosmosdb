---
title: Resume LangGraph from Checkpoint After Interrupt
impact: HIGH
impactDescription: enables multi-turn conversations with persistent state
tags: pattern, langgraph, fastapi, checkpointing, resume
---

## Resume LangGraph from Checkpoint After Interrupt

**Impact: HIGH (enables multi-turn conversations with persistent state)**

When a LangGraph graph pauses at an `interrupt()` node, resume it with `Command(resume=...)` using the same thread ID. Let the graph and checkpointer restore the saved state instead of reconstructing input from raw checkpoint records or injecting internal execution metadata. For normal conversation turns without a pending interrupt, pass a message update; the checkpointer and message reducer preserve the existing history.

**Incorrect (passing ordinary graph input to a pending interrupt):**

```python
@app.post("/chat/{session_id}")
async def chat(session_id: str, user_message: str):
    config = {"configurable": {"thread_id": session_id}}
    # BAD: Does not supply the resume value required by a pending interrupt
    state = {"messages": [{"role": "user", "content": user_message}]}
    response = await graph.ainvoke(state, config)
    return extract_response(response)
```

**Correct (resume a pending interrupt or submit a normal message update):**

This example assumes a graph compiled with an async-capable checkpointer, `MessagesState` (or an equivalent message reducer), and at most one pending interrupt at a time.

```python
from langgraph.types import Command

@app.post("/chat/{session_id}")
async def chat(session_id: str, user_message: str):
    config = {"configurable": {"thread_id": session_id}}
    graph_state = await graph.aget_state(config)

    if any(task.interrupts for task in graph_state.tasks):
        graph_input = Command(resume=user_message)
    else:
        graph_input = {"messages": [{"role": "user", "content": user_message}]}

    response = await graph.ainvoke(graph_input, config)
    return extract_response(response)
```

**Key details:**
1. Reuse the same `thread_id` to retain conversation state; a new thread ID starts a separate conversation
2. `aget_state()` returns the current `StateSnapshot`; interrupts in its pending tasks identify a paused human-input flow
3. `Command(resume=user_message)` supplies the value returned by `interrupt()` in the restarted node; that node must include the value in its state update if it should become part of the message history
4. Normal input dictionaries do not inherently discard history: `MessagesState` applies its message reducer to the restored state
5. The default `ainvoke()` result contains the full state, plus `__interrupt__` when paused; `extract_response` should surface pending interrupt prompts as well as normal responses
6. For multiple simultaneous interrupts, use an interrupt-ID-to-response mapping in `Command(resume=...)` rather than the single-response flow shown here

References: [LangGraph persistence](https://docs.langchain.com/oss/python/langgraph/persistence), [resuming interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts#resuming-interrupts), [StateSnapshot](https://reference.langchain.com/python/langgraph/types/StateSnapshot)
