---
title: Enable Continuous Backup for Point-in-Time Restore
impact: MEDIUM
impactDescription: enables recovery from accidental data loss
tags: security, backup, disaster-recovery, point-in-time-restore
---

## Enable Continuous Backup for Point-in-Time Restore

**Impact: MEDIUM (enables recovery from accidental data loss)**

Data loss is more often caused by mistakes than by attackers. Enable continuous backup (7 or 30 days) to allow point-in-time restore. Enable it at account creation if possible — switching from periodic to continuous is supported but is a one-way change.

**Incorrect (relying on default periodic backup):**

```bash
# Default periodic backup:
# - 4 hour intervals between backups
# - Only 2 copies retained
# - Recovery requires a support ticket
# - Cannot restore to a specific point in time
# - Data written between backups can be lost permanently

az cosmosdb create \
  --name myaccount \
  --resource-group myrg
  # Default periodic backup — limited recovery options
```

**Correct (continuous backup enabled):**

```bash
# Enable at account creation (preferred)
az cosmosdb create \
  --name myaccount \
  --resource-group myrg \
  --backup-policy-type Continuous \
  --continuous-tier Continuous7Days

# Or upgrade an existing account (one-way change)
az cosmosdb update \
  --name myaccount \
  --resource-group myrg \
  --backup-policy-type Continuous \
  --continuous-tier Continuous7Days

# Tiers available:
# Continuous7Days  — 7-day retention, lower cost
# Continuous30Days — 30-day retention, for compliance-sensitive workloads
```

```bash
# Restore to a specific point in time (self-service, no support ticket)
az cosmosdb restore \
  --account-name myaccount \
  --resource-group myrg \
  --target-database-account-name myaccount-restored \
  --restore-timestamp "2026-05-29T10:00:00Z" \
  --location "East US"
```

Continuous backup protects against:
- Accidental deletion of containers or databases
- Buggy deployments that corrupt data
- Unintended bulk updates or deletes
- Ransomware or malicious data modification (when combined with audit logs to identify the point of compromise)

Reference: [Continuous backup with point-in-time restore in Azure Cosmos DB](https://learn.microsoft.com/azure/cosmos-db/continuous-backup-restore-introduction)
