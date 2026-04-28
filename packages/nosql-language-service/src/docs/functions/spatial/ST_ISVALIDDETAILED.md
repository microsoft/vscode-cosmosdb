# ST_ISVALIDDETAILED

**Category:** Spatial
**Syntax:** `ST_ISVALIDDETAILED(geometry)`

Returns a JSON object with a Boolean `valid` property and a `reason` string if the geometry is invalid.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| `geometry` | GeoJSON | A GeoJSON expression. |

## Return Value
Returns an object: `{valid: true/false, reason: '...'}`.

---

📖 **Documentation:** [ST_ISVALIDDETAILED](https://learn.microsoft.com/en-us/cosmos-db/query/st-isvaliddetailed)
