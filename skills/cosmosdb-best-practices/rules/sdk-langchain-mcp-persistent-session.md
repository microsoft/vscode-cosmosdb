---
title: Use Persistent MCP Client Sessions for Multi-Agent Applications
impact: HIGH
impactDescription: prevents session initialization overhead and connection churn
tags: sdk, python, mcp, session, langchain
---

## Use Persistent MCP Client Sessions for Multi-Agent Applications

**Impact: HIGH (prevents session initialization overhead and connection churn)**

When using `MultiServerMCPClient` with LangGraph agents, avoid creating a new client instance per request. MCP sessions involve transport negotiation, tool discovery, and server handshakes. Creating a client per request adds latency and may exhaust server connection limits.

**Note:** The API changed significantly in `langchain-mcp-adapters >= 0.2.0`. The persistent session pattern (manual `__aenter__`/`__aexit__`) only applies to versions `< 0.2.0`. In `>= 0.2.0`, sessions are managed internally per call via `get_tools()`.

**Incorrect (new client per request — high overhead, applies to all versions):**

```python
from langchain_mcp_adapters.client import MultiServerMCPClient

async def handle_request(user_input):
    # BAD: Creates a new client (and underlying sessions) for every single request
    client = MultiServerMCPClient({
        "my_server": {"transport": "streamable_http", "url": "http://localhost:8080/mcp"}
    })
    tools = await client.get_tools()
    # ... invoke agent ...
    # Client discarded, next request pays setup cost again
```

**Correct (>= 0.2.0 — single client instance, get_tools() manages sessions internally):**

```python
from langchain_mcp_adapters.client import MultiServerMCPClient

_mcp_client: MultiServerMCPClient | None = None

async def setup_mcp():
    """Call once during application startup."""
    global _mcp_client
    _mcp_client = MultiServerMCPClient({
        "my_server": {
            "transport": "streamable_http",
            "url": f"{MCP_SERVER_BASE_URL}/mcp",
        }
    })
    # get_tools() creates a per-call session under the hood
    tools = await _mcp_client.get_tools()
    return tools

# No explicit cleanup needed — sessions are per-call in >= 0.2.0
```

**Correct (< 0.2.0 only — persistent session initialized once at startup):**

```python
from langchain_mcp_adapters.client import MultiServerMCPClient
from langchain_mcp_adapters.tools import load_mcp_tools

_mcp_client = None
_session_context = None
_persistent_session = None

async def setup_mcp():
    """Call once during application startup (< 0.2.0 API only)."""
    global _mcp_client, _session_context, _persistent_session

    _mcp_client = MultiServerMCPClient({
        "my_server": {"transport": "streamable_http", "url": mcp_server_url}
    })
    _session_context = _mcp_client.session("my_server")
    _persistent_session = await _session_context.__aenter__()

    # Load tools once — they remain valid for the session lifetime
    tools = await load_mcp_tools(_persistent_session)
    return tools

async def cleanup_mcp():
    """Call during application shutdown (< 0.2.0 API only)."""
    global _session_context, _persistent_session
    if _session_context and _persistent_session:
        await _session_context.__aexit__(None, None, None)
        _session_context = None
        _persistent_session = None
```

**Tip:** Wrap the session setup in retry logic with exponential backoff for production deployments where the MCP server may take time to become ready.

Reference: [langchain-mcp-adapters documentation](https://github.com/langchain-ai/langchain-mcp-adapters)
