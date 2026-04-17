---
name: watch-build
description: Watch the GitHub Actions CI pipeline ("Node PR Lint, Build and Test") for the current branch. Use when user says "watch build", "watch CI", "watch pipeline", "check build", "is CI running", or "monitor build".
---

# watch-build

Watch the GitHub Actions pipeline for the current git branch.

## Workflow

### Step 1 — Get current branch

```
git branch --show-current
```

Store as `<branch>`.

---

### Step 2 — Find the latest run

```
gh run list --branch <branch> --workflow "Node PR Lint, Build and Test" --limit 1 --json databaseId,status,conclusion
```

- If the output is an **empty array `[]`**: print `⏳ No CI run found yet for branch '<branch>'. Push your changes and trigger a build first.` and stop.
- If the array has one entry: extract `databaseId`, `status`, `conclusion`.

---

### Step 3 — Watch or report

**If `status` is `completed`:**
```
✅ Run #<databaseId> already completed — conclusion: <conclusion>
View: https://github.com/microsoft/vscode-cosmosdb/actions/runs/<databaseId>
```

**If `status` is `in_progress` or `queued`:**

Run and stream output to the user:
```
gh run watch <databaseId>
```

