---
title: Initialize LangGraph Agents in FastAPI Startup with Retry
impact: HIGH
impactDescription: prevents request failures when dependent services are not yet ready
tags: pattern, fastapi, langgraph, startup, async
---

## Initialize LangGraph Agents in FastAPI Startup with Retry

**Impact: HIGH (prevents request failures when dependent services are not yet ready)**

LangGraph agents that depend on external services (MCP servers, Cosmos DB, Azure OpenAI) must be initialized asynchronously during application startup, not at module import time or on first request. Use FastAPI's startup event (or lifespan) with retry logic to handle cases where dependent services take time to become available (e.g., in container orchestration environments where services start in parallel).

**Incorrect (initialize at module level — blocks import, no retry):**

```python
from langchain_mcp_adapters.client import MultiServerMCPClient

# BAD: Runs at import time, fails if MCP server isn't ready yet
client = MultiServerMCPClient({"server": {"transport": "streamable_http", "url": mcp_url}})
tools = asyncio.run(load_tools(client))  # Blocks and may fail
```

**Incorrect (initialize on first request — slow first response, no retry):**

```python
@app.post("/chat")
async def chat(message: str):
    global _initialized
    if not _initialized:
        # BAD: First user pays full initialization cost (seconds)
        # No retry if MCP server is temporarily unavailable
        await setup_agents()
        _initialized = True
    # ...
```

**Correct (startup event with retry and fallback):**

```python
import asyncio
from fastapi import FastAPI, HTTPException

app = FastAPI()
_agents_ready = False

@app.on_event("startup")
async def initialize_agents():
    global _agents_ready
    max_retries = 5
    retry_delay = 10  # seconds

    for attempt in range(1, max_retries + 1):
        try:
            await setup_agents()  # Connects to MCP, loads tools, creates agents, inits checkpointer
            _agents_ready = True
            return
        except Exception as e:
            if attempt < max_retries:
                await asyncio.sleep(retry_delay)
            else:
                # Start anyway — will initialize on demand
                _agents_ready = False

async def ensure_ready():
    """Dependency that ensures agents are initialized before handling requests."""
    if not _agents_ready:
        try:
            await setup_agents()
        except Exception:
            raise HTTPException(status_code=503, detail="Service unavailable — agents not initialized")

@app.post("/chat")
async def chat(message: str):
    await ensure_ready()
    # ... handle request ...
```

**Production tips:**
- Set retry delay via environment variable (e.g., `STARTUP_DELAY_SECONDS`) for container orchestration tuning
- Add a `/health/ready` endpoint that returns 503 until `_agents_ready` is `True` — used by load balancers and container health probes
- For FastAPI >= 0.93, prefer `lifespan` context manager over deprecated `on_event`

Reference: [FastAPI lifespan events](https://fastapi.tiangolo.com/advanced/events/)
