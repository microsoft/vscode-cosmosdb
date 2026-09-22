---
title: Configure SSL and connection mode for Cosmos DB Emulator
impact: MEDIUM
impactDescription: enables local development with all SDKs
tags: sdk, emulator, ssl, local-development, certificate, gateway-mode, java, netty, truststore
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

**Incorrect (using emulator defaults without gateway mode or trusted local SSL handling):**

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

**Correct (configuring emulator-specific gateway mode and certificate handling per SDK):**

### Java SDK (Detailed)

> **Which emulator are you on?**
> - **Windows desktop emulator** → follow this section.
> - **Linux (vNext) emulator** (`...azure-cosmos-emulator:vnext-latest`, `--protocol https`) → see
>   [Java SDK + Linux (vNext) Emulator over HTTPS](#java-sdk--linux-vnext-emulator-over-https) below.
>   In addition to trusting the cert, the Linux emulator requires connecting via a **SAN-matching
>   host** (`localhost`/`127.0.0.1`) and setting **`endpointDiscoveryEnabled(false)`** — details there.

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

---

### Java SDK + Linux (vNext) Emulator over HTTPS

The steps above target the **Windows desktop emulator**. The **Linux (vNext) emulator**
(`mcr.microsoft.com/cosmosdb/linux/azure-cosmos-emulator:vnext-latest`) run with
`--protocol https` needs two things for the Java SDK that are easy to miss: the emulator's
certificate must be **trusted** (a trust-all `SSLContext` in code is ignored), and you must
connect via a host in the certificate **SAN** (`localhost`/`127.0.0.1`).

**Symptoms (three distinct failures):**

```text
# (a) Cert not trusted, surfaced through Netty's native OpenSSL provider
#     (netty-tcnative). This is the same trust failure as (b), just wrapped
#     by the OpenSSL engine rather than the JDK SSL engine:
com.azure.cosmos.CosmosException: ... General OpenSslEngine problem

# (b) Cert not trusted, surfaced through the JDK SSL provider:
javax.net.ssl.SSLHandshakeException: PKIX path building failed:
  sun.security.provider.certpath.SunCertPathBuilderException:
  unable to find valid certification path to requested target

# (c) Cert trusted, but connecting via a host outside the cert SAN —
#     the Java SDK enforces strict TLS hostname verification:
javax.net.ssl.SSLPeerUnverifiedException:
  No subject alternative DNS name matching <host> found. SANs in the cert: localhost, 127.0.0.1
```

> Note: `(a)` and `(b)` are the **same** underlying trust failure reported by whichever SSL
> provider is active (`netty-tcnative` OpenSSL vs. the JDK). Importing the emulator certificate
> resolves both; the provider does not change the fix.

**⚠️ A programmatic trust-all `SSLContext` does NOT work** — the Java SDK builds its own
Netty `SslContext` from the configured truststore and does **not** honor the JVM-default
`SSLContext`, so an all-trusting `TrustManager` installed via `SSLContext.setDefault(...)` is
silently ignored and the handshake still fails (`PKIX path building failed`). Unlike the
Go/Node/.NET/Python SDKs, the Java SDK has no direct "disable certificate validation" switch —
trust the emulator certificate explicitly via the truststore instead.

**Recommended pattern:**

**Step 1 (primary fix) — Export and import the emulator certificate into the JDK truststore:**
This is sufficient on its own with current SDK builds (verified with `azure-cosmos` 4.65.0 on
Windows and Linux): the native OpenSSL provider (`netty-tcnative`) honors the certificates in
the configured truststore.

```bash
# Export the cert presented by the Linux emulator:
openssl s_client -connect localhost:8081 -servername localhost </dev/null 2>/dev/null \
  | openssl x509 -outform PEM > emulator.crt

# Import it into the JDK truststore (cacerts):
keytool -importcert -trustcacerts -alias cosmos-emulator \
  -file emulator.crt -keystore "$JAVA_HOME/lib/security/cacerts" \
  -storepass changeit -noprompt
```

**Step 2 — Connect via a host that is in the certificate SAN** (`localhost` or `127.0.0.1`).
Any other host name (a container/service alias, for example) fails strict SAN verification
with `No subject alternative DNS name matching <host> found`:

```bash
COSMOS_ENDPOINT=https://localhost:8081
```

**Step 3 — Use Gateway mode, pin the endpoint, and disable endpoint discovery.**
`endpointDiscoveryEnabled(false)` stops the SDK from following the advertised `127.0.0.1`
loopback; do **not** rely on a trust-all `SSLContext`:

```java
CosmosClient client = new CosmosClientBuilder()
    .endpoint(System.getenv("COSMOS_ENDPOINT"))   // https://localhost:8081 (SAN-matching host)
    .key(System.getenv("COSMOS_KEY"))             // well-known emulator key
    .gatewayMode()                                 // required for the emulator
    .endpointDiscoveryEnabled(false)               // don't follow the advertised 127.0.0.1 loopback
    .buildClient();
```

**Step 4 (fallback) — If the imported cert is not honored on your Netty/tcnative build,**
force the JDK SSL provider so the JDK truststore (`cacerts`) is consulted directly. Some
older `netty-tcnative` builds keep separate trust material; this switch sidesteps that:

```bash
# As a JVM system property:
-Dio.netty.handler.ssl.noOpenSsl=true

# Equivalently, exclude netty-tcnative-boringssl-static from the dependency tree.
```

**Verify:**

```bash
# With the emulator cert imported into the truststore -> connects over HTTPS:
mvn -q compile exec:java -Dexec.mainClass=com.example.Main

# If your build still fails with "General OpenSslEngine problem", add the JDK-SSL-provider switch:
MAVEN_OPTS="-Dio.netty.handler.ssl.noOpenSsl=true" \
  mvn -q compile exec:java -Dexec.mainClass=com.example.Main
```

**Key Points (Linux vNext + Java):**
- Importing the emulator certificate into the truststore (`cacerts` or a custom truststore via `-Djavax.net.ssl.trustStore`) is the primary fix — with current builds the `netty-tcnative` OpenSSL provider honors it (verified with `azure-cosmos` 4.65.0).
- A programmatic trust-all `SSLContext` is ignored — the SDK builds its own `SslContext` from the configured truststore, not the JVM-default `SSLContext`. Trust the cert explicitly instead.
- The emulator's self-signed cert has SAN = `localhost, 127.0.0.1` only — connect via one of those hosts or strict TLS hostname verification fails.
- Use `gatewayMode()` and `endpointDiscoveryEnabled(false)`; pin the endpoint to the SAN-matching host.
- Fallback: if a particular `netty-tcnative` build does not honor the imported cert, set `-Dio.netty.handler.ssl.noOpenSsl=true` (or exclude `netty-tcnative-boringssl-static`) to force the JDK SSL provider.

Reference: [Azure Cosmos DB Java SDK v4](https://learn.microsoft.com/azure/cosmos-db/sdk-java-v4)

---

### Rust SDK (`azure_data_cosmos`)

The Rust SDK provides a built-in method to accept the emulator's self-signed certificate:

```rust
use azure_data_cosmos::{
    CosmosAccountEndpoint, CosmosAccountReference, CosmosClient, CosmosClientBuilder,
};
use azure_core::credentials::Secret;

// ✅ Emulator configuration — accepts invalid certificates
let endpoint: CosmosAccountEndpoint = "https://localhost:8081"
    .parse()
    .expect("valid endpoint");

let account = CosmosAccountReference::with_master_key(
    endpoint,
    Secret::from("C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==".to_string()),
);

let client = CosmosClientBuilder::new()
    .with_allow_emulator_invalid_certificates(true)  // Accept self-signed cert
    .build(account)
    .await
    .expect("build client");

// For production, omit with_allow_emulator_invalid_certificates:
// CosmosClientBuilder::new().build(account).await
```

**Required Cargo.toml features:**
```toml
[dependencies]
azure_data_cosmos = { version = "0.31", features = ["key_auth", "hmac_rust", "allow_invalid_certificates"] }
azure_core = "0.32"
```

> **Note:** The `allow_invalid_certificates` feature must be enabled in Cargo.toml for
> `with_allow_emulator_invalid_certificates(true)` to compile.

---

Reference: [Use the Azure Cosmos DB Emulator for local development](https://learn.microsoft.com/azure/cosmos-db/emulator)
