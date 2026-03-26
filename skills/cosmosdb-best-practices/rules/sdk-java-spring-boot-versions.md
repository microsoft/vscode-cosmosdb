---
title: Spring Boot and Java version compatibility for Cosmos DB SDK
impact: CRITICAL
impactDescription: Prevents build failures due to version incompatibility between Spring Boot and Java
tags: java, spring-boot, sdk, version-requirements, compatibility
---

## Spring Boot and Java Version Requirements

The Azure Cosmos DB Java SDK works with various Spring Boot versions, but each Spring Boot version has **strict Java version requirements** that must be met for the project to build successfully.

**Problem:**

Developers may encounter build failures with cryptic error messages when the Java version doesn't match Spring Boot requirements:

```
[ERROR] bad class file...has wrong version 61.0, should be 55.0
[ERROR] release version 17 not supported
```

These errors occur when:
- Spring Boot 3.x is used with Java 11 or lower
- The JAVA_HOME environment variable points to an incompatible Java version
- Maven/Gradle is configured to use a different Java version than expected

**Solution:**

Always match your Java version to your Spring Boot requirements:

### Version Compatibility Matrix

| Spring Boot Version | Minimum Java | Recommended Java | Azure Cosmos SDK | Notes |
|---------------------|--------------|------------------|------------------|-------|
| **3.2.x** | 17 | 17 or 21 | 4.52.0+ | **Requires Java 17+** (non-negotiable) |
| **3.1.x** | 17 | 17 or 21 | 4.52.0+ | **Requires Java 17+** (non-negotiable) |
| **3.0.x** | 17 | 17 | 4.52.0+ | **Requires Java 17+** (non-negotiable) |
| **2.7.x** | 8 | 11 or 17 | 4.52.0+ | Long-term support, uses `javax.*` |

### pom.xml Configuration

For **Spring Boot 3.x** (requires Java 17+):

```xml
<parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>3.2.1</version>
</parent>

<properties>
    <java.version>17</java.version>
    <maven.compiler.source>17</maven.compiler.source>
    <maven.compiler.target>17</maven.compiler.target>
    <azure.cosmos.version>4.52.0</azure.cosmos.version>
</properties>

<dependencies>
    <dependency>
        <groupId>com.azure</groupId>
        <artifactId>azure-cosmos</artifactId>
        <version>${azure.cosmos.version}</version>
    </dependency>
</dependencies>
```

For **Spring Boot 2.7.x** (compatible with Java 8, 11, or 17):

```xml
<parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>2.7.18</version>
</parent>

<properties>
    <java.version>11</java.version>  <!-- or 17 -->
    <azure.cosmos.version>4.52.0</azure.cosmos.version>
</properties>
```

### Verify Your Environment

Before building, ensure your Java version matches your Spring Boot requirements:

```bash
# Check Java version
java -version

# Check Maven is using the correct Java version
mvn -version

# Set JAVA_HOME if needed (Windows PowerShell)
$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-17.0.10.7-hotspot"
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"

# Set JAVA_HOME if needed (macOS/Linux)
export JAVA_HOME=/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home
export PATH=$JAVA_HOME/bin:$PATH
```

### Key Differences Between Spring Boot 2.x and 3.x

| Aspect | Spring Boot 2.7.x | Spring Boot 3.x |
|--------|-------------------|-----------------|
| Minimum Java | Java 8 | **Java 17** |
| Package namespace | `javax.*` | `jakarta.*` |
| Azure Cosmos SDK | 4.52.0+ | 4.52.0+ |
| Migration effort | N/A | High (package renames) |

**Key Points:**

- **Spring Boot 3.x is NOT compatible with Java 11 or lower** - the build will fail immediately
- Always set `JAVA_HOME` to point to the correct Java version before building
- Use explicit `maven.compiler.source` and `maven.compiler.target` properties to avoid ambiguity
- Spring Boot 3.x requires migrating from `javax.*` to `jakarta.*` packages (breaking change)
- The Azure Cosmos DB Java SDK (4.52.0+) works with both Spring Boot 2.7.x and 3.x

**Common Pitfalls:**

1. **Multiple Java versions installed**: System may default to older Java version
   - Solution: Explicitly set `JAVA_HOME` before building

2. **IDE using different Java than terminal**: IntelliJ/Eclipse may use project JDK settings
   - Solution: Configure IDE project SDK to match Spring Boot requirements

3. **Docker/CI environments**: Base image Java version may not match
   - Solution: Use `eclipse-temurin:17-jdk` or `amazoncorretto:17` for Spring Boot 3.x

**References:**

- [Spring Boot 3.x System Requirements](https://docs.spring.io/spring-boot/docs/current/reference/html/getting-started.html#getting-started.system-requirements)
- [Spring Boot 2.7.x System Requirements](https://docs.spring.io/spring-boot/docs/2.7.x/reference/html/getting-started.html#getting-started-system-requirements)
- [Azure Cosmos DB Java SDK](https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/sdk-java-v4)
