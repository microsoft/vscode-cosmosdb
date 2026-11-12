This project welcomes contributions and suggestions. Most contributions require you to
agree to a Contributor License Agreement (CLA) declaring that you have the right to,
and actually do, grant us the rights to use your contribution. For details, visit
https://cla.microsoft.com.

When you submit a pull request, a CLA-bot will automatically determine whether you need
to provide a CLA and decorate the PR appropriately (e.g., label, comment). Simply follow the
instructions provided by the bot. You will only need to do this once across all repositories using our CLA.

There are several ways you can contribute to the [vscode-cosmosdb repository](https://github.com/Microsoft/vscode-cosmosdb):

- **Ideas, feature requests and bugs**: We are open to all ideas, and we want to get rid of bugs! Use the [Issues](https://github.com/Microsoft/vscode-cosmosdb/issues) section to report a new issue, provide your ideas or contribute to existing threads.

- **Documentation**: Found a typo or strangely worded sentences? Submit a PR!

- **Code**: Contribute bug fixes, features or design changes:
  - Clone the repository and open it in VS Code.
  - Run `Extensions: Show Recommended Extensions` from the [command palette](https://code.visualstudio.com/docs/getstarted/userinterface#_command-palette) and install all extensions listed under "Workspace Recommendations"

  - Open the terminal (press <kbd>CTRL</kbd>+<kbd>\`</kbd>) and run `npm install`.

  - Build: press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd>, or press <kbd>F1</kbd> and type `Tasks: Run Build Task`.

  - Debug: Select the `Launch Extension` configuration in the Debug side bar and press <kbd>F5</kbd> to start debugging the extension.

### CODA conformance

`package.json.externalSpecifications.coda` pins the Git repository, tracking ref, full commit SHA and feature directory.
The SHA, not the current branch tip, determines the downloaded revision. Update the pin deliberately when adopting
another revision; normal builds and unit tests never fetch or repin CODA.

```shell
npm run fetch-coda
npm run test:coda -- --detectors DX-001,DX-011,DX-020
npm run test:coda
npm run coda:check
```

The fetch command requires Git and access to the configured private Azure DevOps repository through your existing
Git credential helper. It does not accept or store tokens in the manifest. Each commit has an isolated checkout under
`.coda`; failed downloads preserve previous checkouts, and modified caches are rejected rather than reset.
No upstream executable, Python dependency, MCP process or Azure resource collector is run.

The test command verifies the pinned checkout and compiles the original `.feature` files with Cucumber's Gherkin
compiler. TypeScript bindings prepare fixtures and call production detector evaluations and the native registry.
Bindings cover DX-001 through DX-024, including production metric/log readers and explicit acquisition failures.
The explicit subset command selects only those features; the unfiltered command selects **every** scenario and fails on
unsupported detectors, unbound steps, unsupported arguments or failed assertions. A selected subset is not a full
conformance pass. At the current pin all 379 scenarios pass, with no unbound, skipped or unexecuted scenarios.
Successful empty consumption reads count as idle for DX-004; Monitor request and embedded metric failures do not.
DX-017 accounts for arithmetic roundoff when comparing fitted growth with the inclusive 0.1 GiB/day floor.
These synthetic contract checks do not replace live collector acceptance.

The local `.coda/conformance.json` report records the source SHA, full scenario inventory and passed/failed/unbound/
not-selected counts. This report and downloaded files are private, Git-ignored, excluded from formatting/linting and
excluded from VSIX packaging. Do not upload them to public logs or artifacts. Public GitHub Actions execution is refused
unless an operator explicitly sets `CODA_TRUSTED_PRIVATE_RUNNER=1` on a genuinely trusted private runner.
Ordinary contributors without private-source access can run the infrastructure's synthetic unit tests without CODA.
`npm run test:coda-tools` checks download integrity and freshness relationships against disposable local Git repositories.
It runs as an independent yellow `coda-tools` branch alongside magenta Vitest and cyan migration-skill tests in both
`npm run vitest` and `npm run vitest:coverage`. Parser/binding regressions do not need private-source access.
Public CI against the original contracts requires an approved redistributable upstream bundle.

`npm run coda:check` compares the configured `trackingRef` HEAD with the immutable pin without repinning or touching the
conformance cache. Equality exits 0; a mismatch exits 1 with exact upstream-ahead and upstream-behind commit counts.
Rewound, divergent and unrelated histories are distinguished. Authentication, missing refs/objects and network errors
also fail explicitly as unverifiable. History is fetched into a disposable bare repository, never checked out or executed.

The existing package-feed workflow has an independent `CODA Freshness` advisory job. It is temporarily disabled for all
hosted triggers with `if: ${{ false }}` until server-side verification and private-source access are needed. The job
appears as skipped, not as verified current; local `npm run coda:check` remains available.
When re-enabled, failures remain red without cancelling the package-feed job or adding dependencies to build/package
workflows. Keep this job optional in branch rulesets; required-check configuration is an owner responsibility and is not
changed by the workflow.
Push/manual runs can use an owner-configured read-only Azure DevOps `CODA_READ_TOKEN` secret. Git credentials also work
locally. **All pull requests receive no private-source token**, including same-repository PRs; without another authorized
credential the private-repository check fails as unverifiable, not as current. This metadata-only job does not run
private scenarios or publish their logs/artifacts.

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/).
For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/)
or contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.
