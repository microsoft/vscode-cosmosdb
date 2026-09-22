---
title: Assign Minimum RBAC Roles with Narrow Scope
impact: HIGH
impactDescription: limits blast radius of compromised identities
tags: security, rbac, least-privilege, roles
---

## Assign Minimum RBAC Roles with Narrow Scope

**Impact: HIGH (limits blast radius of compromised identities)**

Grant each identity only the Cosmos DB data plane role it needs, scoped to the narrowest resource level possible. Avoid account-wide contributor access when an app only reads from a single container. Separate data plane access (read/write data) from control plane access (manage account settings).

**Incorrect (over-privileged access):**

```bash
# WRONG: Granting full Contributor at account scope to an app that only reads data
az cosmosdb sql role assignment create \
  --account-name myaccount \
  --resource-group myrg \
  --role-definition-id "00000000-0000-0000-0000-000000000002" \
  --principal-id <app-principal-id> \
  --scope "/"

# WRONG: Giving the app control plane access (can delete containers, change settings)
az role assignment create \
  --role "Contributor" \
  --assignee <app-principal-id> \
  --scope "/subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.DocumentDB/databaseAccounts/myaccount"

# WRONG: Sharing one identity across multiple services
# If one service is compromised, attacker gets access to everything
```

**Correct (least privilege, narrowly scoped):**

```bash
# Built-in data plane roles:
# Cosmos DB Built-in Data Reader:      00000000-0000-0000-0000-000000000001
# Cosmos DB Built-in Data Contributor: 00000000-0000-0000-0000-000000000002

# Read-only app: grant Reader scoped to specific container
az cosmosdb sql role assignment create \
  --account-name myaccount \
  --resource-group myrg \
  --role-definition-id "00000000-0000-0000-0000-000000000001" \
  --principal-id <reader-app-principal-id> \
  --scope "/dbs/mydb/colls/products"

# Read-write app: grant Contributor scoped to specific database
az cosmosdb sql role assignment create \
  --account-name myaccount \
  --resource-group myrg \
  --role-definition-id "00000000-0000-0000-0000-000000000002" \
  --principal-id <writer-app-principal-id> \
  --scope "/dbs/mydb"

# CI/CD pipeline: only data plane write for schema migrations
az cosmosdb sql role assignment create \
  --account-name myaccount \
  --resource-group myrg \
  --role-definition-id "00000000-0000-0000-0000-000000000002" \
  --principal-id <cicd-principal-id> \
  --scope "/dbs/mydb"
```

Guidelines for role assignment:
- **Application**: Data plane only, minimum role (Reader vs Contributor), scoped to its database or container
- **Developers**: Data plane access on dev accounts, scoped narrowly, using their own Entra ID identity
- **CI/CD pipeline**: Only permissions required to deploy — often just data plane write, sometimes control plane for container management
- **Each identity gets its own access** — never share a single credential across users, environments, or systems

Reference: [Use data plane role-based access control with Azure Cosmos DB](https://learn.microsoft.com/azure/cosmos-db/nosql/security/how-to-grant-data-plane-role-based-access)
