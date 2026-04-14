# GitHub Copilot Instructions for vscode-cosmosdb

## Critical Build Commands

| Command                | Purpose                                                      |
| ---------------------- | ------------------------------------------------------------ |
| `npm run build`        | **Build the project** (use this, NOT `npm run compile`)      |
| `npm run lint`         | Check for linting errors                                     |
| `npm run prettier-fix` | Format code                                                  |
| `npm run l10n`         | Update localization files after changing user-facing strings |

> **NEVER use `npm run compile`** - always use `npm run build` to build the project.

## Localization

- Do **not** make direct changes to localization files inside the `l10n/` (e.g., `bundle.l10n.json`, `bundle.l10n.[lang].json`, etc.) folder or `package.[lang].nls.json` files (e.g., `package.nls.de.json`, `package.nls.fr.json`, etc.).
- To update strings used in `package.json`, modify `package.nls.json` only. Do **not** update the actual translation files.
- After modifying any localizable strings, always run `npm run l10n` to update strings.
- Each `l10n.t()` translation key (the template string) must be **500 characters or fewer**. If a string exceeds this limit, split it into multiple separate `l10n.t()` calls and concatenate them (e.g., `l10n.t('Part one.') + l10n.t('Part two.')`).

## Accessibility Skill Routing

- When implementing or modifying UI in React/Fluent UI webviews (for example under `src/webviews/`), use the `accessibility-aria-expert` skill.
- Apply the skill for ARIA labeling, tooltip accessibility, keyboard/focus behavior, status announcements, and dialog focus management.
- Keep all user-facing accessibility messages localizable and follow the Localization rules above.

## Validation Before Finishing

Before finishing work, agents **must** run the following steps in order:

1. **Localization** — If any user-facing strings were added, modified, or removed, run:
   ```bash
   npm run l10n
   ```
2. **Formatting** — Run Prettier to ensure all files meet formatting standards:
   ```bash
   npm run prettier-fix
   ```
3. **Linting** — Run ESLint to confirm there are no linting errors:
   ```bash
   npm run lint
   ```

> **An agent must not finish or terminate until all three steps above have been run and pass successfully.** Skipping these steps leads to CI failures.
