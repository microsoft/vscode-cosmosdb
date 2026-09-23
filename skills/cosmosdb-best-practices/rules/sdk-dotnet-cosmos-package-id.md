---
title: Use Microsoft.Azure.Cosmos package, not abandoned Azure.Cosmos
impact: HIGH
impactDescription: Prevents build failures from referencing non-existent package versions
tags: sdk, dotnet, nuget, package, build-error
---

## Use Microsoft.Azure.Cosmos package, not abandoned Azure.Cosmos

The canonical .NET SDK for Azure Cosmos DB is **`Microsoft.Azure.Cosmos`** (v3.x, currently GA). Never reference the **`Azure.Cosmos`** package — it was an abandoned v4-preview experiment that only shipped three preview versions (`4.0.0-preview` through `4.0.0-preview3`) and has no stable release. Referencing `Azure.Cosmos` with a 3.x version number will fail with **NU1103** because no such version exists.

**Incorrect (wrong package id — causes build failure):**

```xml
<ItemGroup>
  <!-- WRONG: Azure.Cosmos has no 3.x release. Only abandoned 4.0.0-preview exists. -->
  <PackageReference Include="Azure.Cosmos" Version="3.47.2" />
</ItemGroup>
```

```
error NU1103: Unable to find a stable package Azure.Cosmos with version (>= 3.47.2)
```

**Correct (canonical GA package):**

```xml
<ItemGroup>
  <PackageReference Include="Microsoft.Azure.Cosmos" Version="3.47.0" />
</ItemGroup>
```

**Key Points:**

- **Always use `Microsoft.Azure.Cosmos`** — this is the only supported, GA Cosmos DB .NET SDK
- **`Azure.Cosmos` is abandoned** — the v4 rewrite built on `Azure.Core` was never released as stable
- **No 3.x versions of `Azure.Cosmos` exist** — only `4.0.0-preview`, `4.0.0-preview2`, and `4.0.0-preview3`
- **Do not confuse package ids** — `Microsoft.Azure.Cosmos` 3.x is GA; `Azure.Cosmos` 4.x-preview is dead
- **Applies to all .NET project types** — ASP.NET Core, Azure Functions, class libraries, console apps

Reference: [Microsoft.Azure.Cosmos NuGet package](https://www.nuget.org/packages/Microsoft.Azure.Cosmos)
