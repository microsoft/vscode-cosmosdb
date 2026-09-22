---
title: Configure Private Endpoints with Correct DNS Resolution
impact: HIGH
impactDescription: client connectivity failure when public network access is disabled and DNS resolves to the public endpoint
tags: connectivity, private-endpoint, dns, vnet, security, portal
---

Private endpoints route Cosmos DB traffic through your VNet instead of the public internet, but they require correct DNS configuration to work. The most common connectivity failures after enabling private endpoints are DNS misconfigurations, VNet peering without private DNS integration, and portal access blocked by browser Private Network Access (PNA) policies.

### Common Issue: DNS Not Resolving to Private IP

**Incorrect (private endpoint created but DNS still resolves to public IP):**

```bash
# WRONG: Private endpoint created without private DNS zone integration
az network private-endpoint create \
  --name myaccount-pe \
  --resource-group myrg \
  --vnet-name myvnet \
  --subnet default \
  --private-connection-resource-id <cosmos-resource-id> \
  --group-id Sql \
  --connection-name myaccount-connection
  # Missing: DNS zone integration

# Result: myaccount.documents.azure.com still resolves to public IP (104.x.x.x)
# Applications fail with connection timeout or "unable to reach" errors
```

**Correct (private endpoint with automatic DNS integration):**

```bash
# Create private DNS zone for Azure Cosmos DB for NoSQL (documents.azure.com)
# (Other Cosmos DB APIs use different privatelink zones and Private Link group IDs.)
az network private-dns zone create \
  --resource-group myrg \
  --name privatelink.documents.azure.com

# Link DNS zone to your VNet
az network private-dns link vnet create \
  --resource-group myrg \
  --zone-name privatelink.documents.azure.com \
  --name myaccount-dnslink \
  --virtual-network myvnet \
  --registration-enabled false

# Create private endpoint WITH DNS integration
az network private-endpoint create \
  --name myaccount-pe \
  --resource-group myrg \
  --vnet-name myvnet \
  --subnet default \
  --private-connection-resource-id <cosmos-resource-id> \
  --group-id Sql \
  --connection-name myaccount-connection

# Associate the private endpoint with the Private DNS zone (DNS zone group)
# Note: --zone-name here is a required label for this entry inside the zone
# group, not a DNS zone name. Any short identifier works.
az network private-endpoint dns-zone-group create \
  --resource-group myrg \
  --endpoint-name myaccount-pe \
  --name myaccount-zonegroup \
  --zone-name myzone \
  --private-dns-zone /subscriptions/<sub>/resourceGroups/myrg/providers/Microsoft.Network/privateDnsZones/privatelink.documents.azure.com

# Verify DNS resolution from a VM in the VNet:
# nslookup myaccount.documents.azure.com
# Should return private IP (10.x.x.x), not public (104.x.x.x)
```

### Customer-Managed DNS Configuration

If your organization uses custom DNS servers (not Azure-provided DNS), you must configure DNS forwarding:

```bash
# Your custom DNS servers must forward *.privatelink.documents.azure.com queries
# to Azure DNS (168.63.129.16)

# Option 1: Conditional forwarder on your DNS servers
# Forward privatelink.documents.azure.com → 168.63.129.16

# Option 2: DNS A records (manual approach, not recommended)
# Create A record: myaccount.privatelink.documents.azure.com → <private-endpoint-ip>
# Must update manually if private endpoint IP changes
```

**Verify DNS resolution from your application host:**

```bash
# Windows
nslookup myaccount.documents.azure.com

# Linux
dig myaccount.documents.azure.com

# Expected: 
# - Private DNS zone linked to this VNet: resolves to private IP (10.x.x.x)
# - Private DNS zone not linked / not used: resolves to public IP (104.x.x.x) and will time out when public network access is disabled
```

### VNet Peering and Hub-Spoke Topologies

Private endpoint DNS integration is **per-VNet**. If you have hub-spoke or peered VNets:

```bash
# Scenario: Private endpoint in Hub VNet, applications in Spoke VNets

# Link the private DNS zone to ALL VNets that need access
az network private-dns link vnet create \
  --resource-group myrg \
  --zone-name privatelink.documents.azure.com \
  --name spoke1-dnslink \
  --virtual-network spoke1-vnet \
  --registration-enabled false

az network private-dns link vnet create \
  --resource-group myrg \
  --zone-name privatelink.documents.azure.com \
  --name spoke2-dnslink \
  --virtual-network spoke2-vnet \
  --registration-enabled false

# VNet peering must allow forwarded traffic:
az network vnet peering update \
  --name hub-to-spoke1 \
  --resource-group myrg \
  --vnet-name hub-vnet \
  --allow-forwarded-traffic true
```

### Portal and Data Explorer Access with Private Endpoints

When you **disable public network access** and use only private endpoints, the Azure Portal and Data Explorer cannot reach your account from your browser (they run client-side, outside your VNet).

**Symptoms:**
- Portal shows "Unable to load containers" or "Connection timeout"
- Data Explorer queries fail with network errors
- Chromium browsers block with **Private Network Access (PNA)** CORS errors

**Solutions (in order of preference):**

**Option 1 (recommended): Manage from inside the VNet.** Run management commands from a host that already has private network access — an Azure Bastion-connected VM, a Cloud Shell session with VNet integration, or a developer workstation on a VPN/ExpressRoute connection.

```bash
# From a VM in the VNet (e.g., reached via Azure Bastion)
az cosmosdb sql database list --account-name myaccount --resource-group myrg
```

**Option 2: VS Code Remote Development.** Connect to a VM inside the VNet via Remote-SSH or Bastion and use the Azure Cosmos DB extension from there.

**Option 3: Allow only the published Azure portal middleware IPs.** This is a narrow allowlist of portal-only addresses. Microsoft publishes the current list per API and cloud environment in [Allow requests from the Azure portal](https://learn.microsoft.com/azure/cosmos-db/how-to-configure-firewall#allow-requests-from-the-azure-portal). Fetch the current values from that doc rather than hardcoding them, because the published IPs change over time. The Azure portal also exposes an **Add Azure Portal Middleware IPs** button that adds the correct set automatically.

**Anti-pattern: do not use `--ip-range-filter "0.0.0.0"` as a "portal exception".**
The `0.0.0.0` entry corresponds to the **Accept connections from within Azure datacenters** toggle. It is **not** portal-only: it permits inbound traffic from any IP in Azure's datacenter ranges, which includes resources owned by other Azure customers. Microsoft's own firewall documentation warns that this option "configures the firewall to allow all requests from Azure, including requests from the subscriptions of other customers deployed in Azure" and "limits the effectiveness of a firewall policy." Prefer Options 1–3 above.

**Chromium Private Network Access (PNA) blocking:**
- Affects Chrome, Edge, Brave when the portal tries to reach a private endpoint from a public-internet origin
- Browser blocks "public-to-private" requests as a security policy
- Solution: use Option 1 or 2 (browse from inside the VNet); Option 3 also works because the request then originates from a permitted portal IP rather than the user's browser

### Disable Public Access (Production Best Practice)

After private endpoint and DNS are working:

```bash
# Fully disable public internet access
az cosmosdb update \
  --name myaccount \
  --resource-group myrg \
  --public-network-access DISABLED

# All traffic must flow through private endpoints
# Portal access will require Option 2 or 3 above
```

### Troubleshooting Checklist

| Symptom | Likely Cause | Solution |
|---|---|---|
| Connection timeout from application | DNS not configured | Link private DNS zone to VNet |
| Resolves to public IP (104.x.x.x) | Missing DNS integration | Create/associate a private DNS zone group on the private endpoint and ensure the private DNS zone is linked to the VNet |
| Works from one VNet, not another | DNS zone not linked to spoke | Link DNS zone to all peered VNets |
| Portal shows "Unable to load" | Public access disabled | Manage from inside the VNet (Bastion/Cloud Shell) or add only the published portal middleware IPs — do not use `0.0.0.0` |
| Chromium PNA CORS error | Browser blocks public→private | Access from within the VNet, or use the published portal middleware IPs |
| Custom DNS servers: no resolution | DNS not forwarding to Azure | Configure conditional forwarder to 168.63.129.16 |

### Connection String Unchanged

**Important:** Your connection string does NOT change when using private endpoints. Applications still use `myaccount.documents.azure.com` — DNS resolution handles routing to the private IP.

```csharp
// Same connection string before and after private endpoint
var client = new CosmosClient(
    "https://myaccount.documents.azure.com:443/",
    tokenCredential: new DefaultAzureCredential()
);
// DNS automatically resolves to private IP when query originates from VNet
```

References:
- [Configure private endpoints for Azure Cosmos DB](https://learn.microsoft.com/azure/cosmos-db/how-to-configure-private-endpoints)
- [Azure Private Endpoint DNS configuration](https://learn.microsoft.com/azure/private-link/private-endpoint-dns)
- [Troubleshoot Azure Private Endpoint connectivity](https://learn.microsoft.com/azure/private-link/troubleshoot-private-endpoint-connectivity)