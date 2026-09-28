---
title: Restrict Network Access
impact: HIGH
impactDescription: reduces attack surface from public internet
tags: security, network, firewall, ip-restriction, private-endpoint
---

## Restrict Network Access

**Impact: HIGH (reduces attack surface from public internet)**

By default, a Cosmos DB endpoint is publicly reachable from anywhere on the internet. If a credential leaks, nothing stands between an attacker and your data. Restrict access to known IP ranges as a baseline, and plan to move to private endpoints for production workloads.

**Incorrect (unrestricted public access):**

```bash
# WRONG: Default configuration — account is accessible from any IP address worldwide
# No --ip-range-filter means open to the internet

az cosmosdb create \
  --name myaccount \
  --resource-group myrg
  # No network restrictions = reachable from anywhere
```

**Correct (restrict to known IPs as baseline):**

```bash
# Restrict access to known IP addresses (office, CI/CD egress, developer IPs)
az cosmosdb update \
  --name myaccount \
  --resource-group myrg \
  --ip-range-filter "203.0.113.10,198.51.100.0/24"

# For production: use private endpoints (no public internet exposure)
az cosmosdb update \
  --name myaccount \
  --resource-group myrg \
  --public-network-access DISABLED

# Create a private endpoint in your VNet
az network private-endpoint create \
  --name myaccount-pe \
  --resource-group myrg \
  --vnet-name myvnet \
  --subnet default \
  --private-connection-resource-id <cosmos-account-resource-id> \
  --group-id Sql \
  --connection-name myaccount-connection
```

Network restriction tiers (from minimum to most secure):
1. **IP allowlisting** (day one minimum): restrict to office, CI/CD, and developer IPs
2. **Service endpoints**: allow access from specific Azure VNet subnets
3. **Private endpoints** (production goal): no public exposure, traffic stays on Microsoft backbone

Even with Entra ID authentication, network restrictions add defense-in-depth — a compromised token is useless if the attacker cannot reach the endpoint.

Reference: [Configure IP firewall in Azure Cosmos DB](https://learn.microsoft.com/azure/cosmos-db/how-to-configure-firewall)
