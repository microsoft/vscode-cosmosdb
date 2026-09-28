---
title: Tag AI Messages with Agent Name for API Response Attribution
impact: MEDIUM
impactDescription: enables API layer to report which agent generated a response for UI display and logging
tags: pattern, langgraph, multi-agent, attribution, messages
---

## Tag AI Messages with Agent Name for API Response Attribution

**Impact: MEDIUM (enables API layer to report which agent generated a response for UI display and logging)**

`create_react_agent` does not set the `name` field on AI messages it produces. If the API layer needs to report which agent generated a response (e.g., for UI display or logging), it has no way to determine this from the message itself. Tag the last AI message with the agent name before returning from each node function.

**Incorrect (no attribution — API cannot determine which agent responded):**

```python
async def call_product_search(state, config):
    response = await product_search_agent.ainvoke(state)
    # BAD: No way to tell which agent produced this response at the API layer
    return Command(update=response, goto=END)
```

**Correct (tag last AI message with agent name):**

```python
def _tag_last_ai_message(response: dict, agent_name: str) -> dict:
    """Set `name` on the last AI message for API-layer attribution."""
    msgs = response.get("messages", [])
    for msg in reversed(msgs):
        if hasattr(msg, "type") and msg.type == "ai" and msg.content:
            msg.name = agent_name
            break
    return response

async def call_product_search(state, config):
    response = await product_search_agent.ainvoke(state)
    # Tag the response so the API layer knows which agent answered
    _tag_last_ai_message(response, "product_search_agent")
    return Command(update=response, goto=END)
```

**Key points:**
1. Iterate in reverse to find the last AI message with content (skip empty tool-call messages)
2. Set `msg.name = agent_name` — LangGraph preserves this field through state updates
3. Apply tagging in every node function before returning the `Command`
4. The API layer can then read `message.name` to display agent attribution in the UI

Reference: [LangGraph multi-agent patterns](https://langchain-ai.github.io/langgraph/concepts/multi_agent/)
