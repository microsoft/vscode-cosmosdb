---
title: Explicitly reference Newtonsoft.Json package
impact: MEDIUM
impactDescription: Prevents build failures and security vulnerabilities from missing or outdated Newtonsoft.Json dependency
tags: sdk, dotnet, dependencies, security, build-error
---

## Explicitly reference Newtonsoft.Json package

The Azure Cosmos DB .NET SDK requires an explicit reference to `Newtonsoft.Json` version 13.0.3 or higher. This dependency is not managed automatically - you must add it directly to your project.

**Problem (build fails without explicit reference):**

```csharp
// Your .csproj only references Cosmos DB SDK
<ItemGroup>
  <PackageReference Include="Microsoft.Azure.Cosmos" Version="3.47.0" />
  <!-- Missing Newtonsoft.Json reference! -->
</ItemGroup>

// Build error:
// error: The Newtonsoft.Json package must be explicitly referenced with version >= 10.0.2.
// Please add a reference to Newtonsoft.Json or set the 
// 'AzureCosmosDisableNewtonsoftJsonCheck' property to 'true' to bypass this check.
```

**Solution (add explicit Newtonsoft.Json reference):**

```xml
<!-- Standard .csproj projects -->
<ItemGroup>
  <PackageReference Include="Microsoft.Azure.Cosmos" Version="3.47.0" />
  <PackageReference Include="Newtonsoft.Json" Version="13.0.4" />
</ItemGroup>
```

**For projects using Central Package Management:**

```xml
<!-- Directory.Packages.props -->
<Project>
  <ItemGroup>
    <PackageVersion Include="Microsoft.Azure.Cosmos" Version="3.47.0" />
    <PackageVersion Include="Newtonsoft.Json" Version="13.0.4" />
  </ItemGroup>
</Project>
```

**Key Points:**

- **Always use version 13.0.3 or higher** - Never use 10.x despite technical compatibility, as it has known security vulnerabilities
- **Required even with System.Text.Json** - The dependency is needed even when using `CosmosClientOptions.UseSystemTextJsonSerializerWithOptions`, because the SDK's internal operations still use Newtonsoft.Json for system types
- **Build check is intentional** - The Cosmos DB SDK includes build targets that explicitly check for this dependency to prevent issues
- **Pin the version explicitly** - Don't rely on transitive dependency resolution
- **SDK compiles against 10.x internally** - But recommends 13.0.3+ to avoid security issues and conflicts

**Version Compatibility:**

| Cosmos DB SDK Version | Minimum Secure Newtonsoft.Json | Recommended |
|-----------------------|--------------------------------|-------------|
| 3.47.0+ | 13.0.3 | 13.0.4 |
| 3.54.0+ | 13.0.4 | 13.0.4 |

**Special Cases:**

**For library projects** (not applications):

If you're building a reusable library and want to defer the Newtonsoft.Json dependency to your library's consumers, you can bypass the build check:

```xml
<PropertyGroup>
  <AzureCosmosDisableNewtonsoftJsonCheck>true</AzureCosmosDisableNewtonsoftJsonCheck>
</PropertyGroup>
```

⚠️ **Warning**: Only use this bypass for libraries. For applications, always add the explicit reference.

**Troubleshooting version conflicts:**

If you see package downgrade errors:

```
error NU1109: Detected package downgrade: Newtonsoft.Json from 13.0.4 to 13.0.3
```

Solution:
1. Check which packages need which versions:
   ```bash
   dotnet list package --include-transitive | findstr Newtonsoft.Json
   ```
2. Update to the highest required version in your central package management or csproj
3. Clean and rebuild:
   ```bash
   dotnet clean && dotnet restore && dotnet build
   ```

**Why This Matters:**

- **Prevents build failures** - The SDK will fail the build if Newtonsoft.Json is missing
- **Security** - Version 10.x has known vulnerabilities that should be avoided
- **Compatibility** - Ensures consistent behavior across different environments
- **Future-proofing** - Explicit references prevent surprises when transitive dependencies change

Reference: [Managing Newtonsoft.Json Dependencies](https://learn.microsoft.com/en-us/azure/cosmos-db/performance-tips-dotnet-sdk-v3?tabs=trace-net-core#managing-newtonsoftjson-dependencies)
