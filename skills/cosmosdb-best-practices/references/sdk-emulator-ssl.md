---
title: Configure SSL and connection mode for Cosmos DB Emulator
impact: MEDIUM
impactDescription: enables local development with all SDKs
tags: sdk, emulator, ssl, local-development, certificate, gateway-mode
---

## Configure SSL and Connection Mode for Cosmos DB Emulator

The Azure Cosmos DB Emulator uses a self-signed SSL certificate that requires special handling. Additionally, **all SDKs should use Gateway connection mode with the emulator** - Direct mode has known issues with the emulator's SSL certificate handling.

### General Guidance (All SDKs)

| Setting | Emulator | Production |
|---------|----------|------------|
| Connection Mode | **Gateway** (required) | Direct (recommended) |
| SSL Validation | Disable or import cert | Normal validation |
| Endpoint | `https://localhost:8081` | Your account URL |
| Key | Well-known emulator key | Your account key |

**Well-known emulator key:** `C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==`

---

### .NET SDK

```csharp
var options = new CosmosClientOptions
{
    ConnectionMode = ConnectionMode.Gateway,  // Required for emulator
    HttpClientFactory = () => new HttpClient(
        new HttpClientHandler
        {
            // Accept self-signed certificate from emulator
            ServerCertificateCustomValidationCallback = 
                HttpClientHandler.DangerousAcceptAnyServerCertificateValidator
        })
};

var client = new CosmosClient(
    "https://localhost:8081",
    "C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==",
    options
);
```

---

### Python SDK

```python
from azure.cosmos import CosmosClient
import urllib3

# Suppress SSL warnings for local development only
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# Python SDK uses Gateway mode by default
client = CosmosClient(
    url="https://localhost:8081",
    credential="C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==",
    connection_verify=False  # Disable SSL verification for emulator
)
```

---

### Node.js SDK

```javascript
const { CosmosClient } = require("@azure/cosmos");

// Disable SSL verification for emulator (development only!)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const client = new CosmosClient({
    endpoint: "https://localhost:8081",
    key: "C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==",
    connectionPolicy: {
        connectionMode: "Gateway"  // Recommended for emulator
    }
});
```

---

### Java SDK (Detailed)

When using the Azure Cosmos DB Emulator with the Java SDK, you must import the emulator's self-signed SSL certificate into the JDK truststore and use Gateway connection mode. Direct mode has persistent SSL issues with the emulator.

**Problem (SSL handshake failures):**

```java
// Without certificate import, you'll see errors like:
// javax.net.ssl.SSLHandshakeException: PKIX path building failed
// sun.security.provider.certpath.SunCertPathBuilderException: 
//   unable to find valid certification path to requested target

// Direct mode fails even after certificate import:
CosmosClientBuilder builder = new CosmosClientBuilder()
    .endpoint("https://localhost:8081")
    .key("...")
    .directMode();  // Will fail with SSL errors!
```

**Solution - Step 1: Export the emulator certificate:**

```powershell
# The emulator stores its certificate at this path (Windows):
# %LOCALAPPDATA%\CosmosDBEmulator\emulator-cert.cer

# Or export from Windows Certificate Manager:
# certmgr.msc → Personal → Certificates → DocumentDbEmulatorCertificate
# Right-click → All Tasks → Export → DER encoded binary X.509 (.CER)
```

**Solution - Step 2: Import certificate into JDK truststore:**

```powershell
# Find your JDK path first:
# java -XshowSettings:properties -version 2>&1 | Select-String "java.home"

# Import the certificate (run as Administrator):
keytool -importcert `
    -alias cosmosemulator `
    -file "C:\Users\<username>\AppData\Local\CosmosDBEmulator\emulator-cert.cer" `
    -keystore "C:\Program Files\Eclipse Adoptium\jdk-17.0.10.7-hotspot\lib\security\cacerts" `
    -storepass changeit `
    -noprompt

# For other JDK distributions, the cacerts location varies:
# - Oracle JDK: $JAVA_HOME/lib/security/cacerts
# - Eclipse Adoptium: $JAVA_HOME/lib/security/cacerts
# - Amazon Corretto: $JAVA_HOME/lib/security/cacerts
```

**Solution - Step 3: Use Gateway mode with the emulator:**

```java
// Gateway mode works reliably with the emulator after certificate import
CosmosClientBuilder builder = new CosmosClientBuilder()
    .endpoint("https://localhost:8081")
    .key("C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==")
    .gatewayMode()  // Required for emulator!
    .consistencyLevel(ConsistencyLevel.SESSION);

CosmosClient client = builder.buildClient();
```

```yaml
# Spring Boot application.properties for emulator:
azure:
  cosmos:
    endpoint: https://localhost:8081
    key: C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==
    database: your-database
    # Note: Spring Data Cosmos uses Gateway mode by default
```

**Alternative - Custom truststore (no admin required):**

If you cannot modify the JDK's `cacerts` (requires administrator access), create a custom truststore instead:

```powershell
# Step 1: Copy JDK's default cacerts to a local custom truststore
$jdkCacerts = "$env:JAVA_HOME\lib\security\cacerts"
Copy-Item $jdkCacerts -Destination .\custom-cacerts

# Step 2: Extract the emulator's SSL certificate
$tcpClient = New-Object System.Net.Sockets.TcpClient("localhost", 8081)
$sslStream = New-Object System.Net.Security.SslStream($tcpClient.GetStream(), $false, {$true})
$sslStream.AuthenticateAsClient("localhost")
$cert = $sslStream.RemoteCertificate
[System.IO.File]::WriteAllBytes("emulator-cert.cer", $cert.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert))
$sslStream.Close(); $tcpClient.Close()

# Step 3: Import into custom truststore
keytool -importcert -alias cosmosemulator -file emulator-cert.cer `
    -keystore custom-cacerts -storepass changeit -noprompt
```

```powershell
# Step 4: Run your app with the custom truststore
java "-Djavax.net.ssl.trustStore=custom-cacerts" `
     "-Djavax.net.ssl.trustStorePassword=changeit" `
     -jar your-app.jar
```

**⚠️ `COSMOS.EMULATOR_SSL_TRUST_ALL` does NOT work with Java/Netty:**

```java
// WARNING: This property does NOT work with the Java Cosmos SDK!
// The Java SDK uses Netty with OpenSSL, which bypasses Java's SSLContext entirely.
// Setting this property has no effect — SSL handshake will still fail.
System.setProperty("COSMOS.EMULATOR_SSL_TRUST_ALL", "true");  // INEFFECTIVE!

// Also ineffective as a JVM argument:
// -DCOSMOS.EMULATOR_SSL_TRUST_ALL=true  // DOES NOT WORK

// Instead, use one of these approaches:
// 1. Import the emulator certificate into the JDK truststore (Step 2 above)
// 2. Use a custom truststore with -Djavax.net.ssl.trustStore (recommended)
```

**Key Points:**
- Direct connection mode does not work reliably with the emulator even after certificate import
- Gateway mode is required for local development with the Java SDK and emulator
- **`COSMOS.EMULATOR_SSL_TRUST_ALL` does NOT work** — the Java SDK uses Netty/OpenSSL which ignores Java SSL system properties. You must import the emulator certificate into a JDK or custom truststore
- The custom truststore approach avoids needing administrator access
- The emulator's well-known key is: `C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==`
- For production, switch back to Direct mode and use your actual Cosmos DB endpoint

Reference: [Use the Azure Cosmos DB Emulator for local development](https://learn.microsoft.com/azure/cosmos-db/emulator)
