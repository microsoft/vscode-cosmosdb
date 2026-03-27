---
title: Configure local development environment to avoid cloud connection conflicts
impact: MEDIUM
impactDescription: prevents accidental connections to production instead of emulator
tags: sdk, local-development, emulator, configuration, environment-variables
---

## Configure Local Development Environment Properly

When developing locally with the Cosmos DB Emulator, system-level environment variables pointing to Azure cloud accounts can override your local configuration, causing unexpected connections to production resources instead of the emulator.

**Problem - System environment variables override local config:**

```python
# Your .env file (local config)
COSMOS_ENDPOINT=https://localhost:8081
COSMOS_KEY=C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==

# But system environment has (from Azure CLI or other tools):
# COSMOS_ENDPOINT=https://my-prod-account.documents.azure.com:443/

# Default dotenv loading does NOT override existing env vars!
from dotenv import load_dotenv
load_dotenv()  # ❌ System COSMOS_ENDPOINT wins - connects to production!
```

**Solution - Force override of environment variables:**

**Python:**

```python
from dotenv import load_dotenv
import os

# Force .env values to override system environment variables
load_dotenv(override=True)  # ✅ .env values take precedence

# Or use explicit defaults for emulator
COSMOS_ENDPOINT = os.getenv("COSMOS_ENDPOINT", "https://localhost:8081")
COSMOS_KEY = os.getenv(
    "COSMOS_KEY", 
    "C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw=="
)
```

**Node.js:**

```javascript
// dotenv also has override option
require('dotenv').config({ override: true });

// Or with explicit defaults
const endpoint = process.env.COSMOS_ENDPOINT || 'https://localhost:8081';
const key = process.env.COSMOS_KEY || 
    'C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==';
```

**.NET:**

```csharp
// appsettings.Development.json takes precedence over appsettings.json
// in Development environment

// appsettings.Development.json
{
  "CosmosDb": {
    "Endpoint": "https://localhost:8081",
    "Key": "C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw=="
  }
}

// Program.cs - Environment-specific config loaded automatically
var builder = WebApplication.CreateBuilder(args);
// Configuration precedence: appsettings.{Environment}.json > appsettings.json > env vars
```

```csharp
// Or use explicit emulator detection
public static class CosmosConfig
{
    public static bool IsEmulator(string endpoint) => 
        endpoint.Contains("localhost") || endpoint.Contains("127.0.0.1");
    
    public static CosmosClientOptions GetClientOptions(string endpoint)
    {
        var options = new CosmosClientOptions();
        
        if (IsEmulator(endpoint))
        {
            options.ConnectionMode = ConnectionMode.Gateway;  // Required for emulator
            options.HttpClientFactory = () => new HttpClient(
                new HttpClientHandler
                {
                    ServerCertificateCustomValidationCallback = 
                        HttpClientHandler.DangerousAcceptAnyServerCertificateValidator
                });
        }
        else
        {
            options.ConnectionMode = ConnectionMode.Direct;  // Production
        }
        
        return options;
    }
}
```

**Java (Spring Boot):**

```yaml
# application.yml - Profile-specific configuration
spring:
  profiles:
    active: local  # Set via SPRING_PROFILES_ACTIVE env var

---
# application-local.yml (local development profile)
azure:
  cosmos:
    endpoint: https://localhost:8081
    key: C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==

---
# application-prod.yml (production profile)
azure:
  cosmos:
    endpoint: ${COSMOS_ENDPOINT}  # From environment
    key: ${COSMOS_KEY}  # From Key Vault ideally
```

**Best practices for local development:**

1. **Use profile/environment-specific configuration files**
   - `.env.local`, `appsettings.Development.json`, `application-local.yml`

2. **Log the endpoint at startup (without the key!)**
   ```python
   print(f"Connecting to Cosmos DB at: {COSMOS_ENDPOINT}")
   # Never log the key!
   ```

3. **Validate you're connecting to emulator**
   ```python
   if "localhost" not in COSMOS_ENDPOINT and "127.0.0.1" not in COSMOS_ENDPOINT:
       print("⚠️ WARNING: Not connecting to local emulator!")
       print(f"Endpoint: {COSMOS_ENDPOINT}")
   ```

4. **Use different database names for dev/prod**
   ```python
   DATABASE_NAME = os.getenv("COSMOS_DATABASE", "dev-database")
   # Production uses: prod-ecommerce
   # Local uses: dev-database (default)
   ```

5. **Clear conflicting system environment variables**
   ```powershell
   # PowerShell - temporarily clear for this session
   $env:COSMOS_ENDPOINT = $null
   $env:COSMOS_KEY = $null
   
   # Or unset permanently
   [Environment]::SetEnvironmentVariable("COSMOS_ENDPOINT", $null, "User")
   ```

**Key Points:**
- System environment variables take precedence over .env files by default
- Use `load_dotenv(override=True)` in Python to force local config
- Use environment/profile-specific configuration files
- Log the endpoint (not the key!) at startup to verify correct connection
- The emulator uses a well-known key - don't use this in production!

Reference: [Azure Cosmos DB Emulator](https://learn.microsoft.com/azure/cosmos-db/emulator)
