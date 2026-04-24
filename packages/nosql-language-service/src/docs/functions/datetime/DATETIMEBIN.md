# DATETIMEBIN

**Category:** Date/Time
**Syntax:** `DATETIMEBIN(datetime, part [, binSize [, origin]])`

Rounds (bins) a datetime value to a multiple of the specified date/time part.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| `datetime` | string | The datetime string. |
| `part` | string | The datetime part to bin by. |
| `binSize` | integer | Optional bin size (default: 1). |
| `origin` | string | Optional origin datetime (default: `'1970-01-01T00:00:00.000000Z'`). |

## Return Value
Returns a datetime string.

---

📖 **Documentation:** [DATETIMEBIN](https://learn.microsoft.com/en-us/cosmos-db/query/datetimebin)
