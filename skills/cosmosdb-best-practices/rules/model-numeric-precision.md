---
title: Understand IEEE 754 Numeric Precision Limits
impact: MEDIUM
impactDescription: prevents silent data loss on large or precise numbers
tags: model, numeric, precision, limits, json, design
---

## Understand IEEE 754 Numeric Precision Limits

Azure Cosmos DB stores numbers using **IEEE 754 double-precision 64-bit** format. This means integers larger than 2^53 and decimals requiring more than ~15-17 significant digits will lose precision silently.

**Incorrect (precision loss with large numbers):**

```csharp
// Anti-pattern 1: Storing large integers that exceed safe range
public class Transaction
{
    public string Id { get; set; }
    
    // 64-bit integer IDs from external systems - DANGER!
    public long ExternalTransactionId { get; set; }  // e.g., 9007199254740993
    // Values > 9,007,199,254,740,992 (2^53) lose precision
    // 9007199254740993 becomes 9007199254740992 silently!
}

// Anti-pattern 2: Financial calculations requiring exact decimal precision
public class Invoice
{
    public string Id { get; set; }
    
    // Double can't represent all decimal values exactly
    public double Amount { get; set; }  // 0.1 + 0.2 != 0.3 in IEEE 754
    public double TaxRate { get; set; }
}

// 99999999999999.99 stored as double may become 99999999999999.98
```

**Correct (preserving precision):**

```csharp
// Solution 1: Store large integers and precise decimals as strings
public class Transaction
{
    public string Id { get; set; }
    
    // Store large IDs as strings to preserve all digits
    [JsonPropertyName("externalTransactionId")]
    public string ExternalTransactionId { get; set; }  // "9007199254740993"
}

// Solution 2: Use string representation for financial amounts
public class Invoice
{
    public string Id { get; set; }
    
    // Store monetary values as strings with fixed decimal places
    [JsonPropertyName("amount")]
    public string Amount { get; set; }  // "99999999999999.99"
    
    [JsonPropertyName("taxRate")]
    public string TaxRate { get; set; }  // "0.0825"
    
    // Parse in application code for calculations
    public decimal GetAmount() => decimal.Parse(Amount);
    public decimal GetTaxRate() => decimal.Parse(TaxRate);
}
```

```csharp
// Solution 3: Store amounts as integer minor units (cents, paise, etc.)
public class Payment
{
    public string Id { get; set; }
    
    // Store $199.99 as 19999 cents - always safe as integer within 2^53
    public long AmountInCents { get; set; }
    public string Currency { get; set; }  // "USD"
    
    // Helper for display
    public decimal GetDisplayAmount() => AmountInCents / 100m;
}

var payment = new Payment
{
    Id = Guid.NewGuid().ToString(),
    AmountInCents = 19999,  // $199.99
    Currency = "USD"
};
await container.CreateItemAsync(payment);
```

Key points:
- **Safe integer range:** -2^53 to 2^53 (±9,007,199,254,740,992)
- **Significant digits:** ~15-17 decimal digits of precision
- Store large integers (snowflake IDs, blockchain hashes) as **strings**
- Store financial/monetary values as **strings** or **integer minor units** (cents)
- Numbers within the safe range (most counters, ages, quantities) are fine as-is

Reference: [Azure Cosmos DB service quotas - Per-item limits](https://learn.microsoft.com/azure/cosmos-db/concepts-limits#per-item-limits)
