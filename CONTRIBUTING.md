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

## Network access in Vitest

The root Vitest setup allows TCP connections to `127.0.0.1` and `::1`, resolves `localhost` only to those addresses,
and preserves local IPC. Unexpected outbound TCP attempts fail the suite even if application code handles the error.
Mock external services in unit tests. This is a Node worker guard, not OS-level isolation: it does not restrict UDP or
child processes.

If a test deliberately needs external TCP, keep it out of the default unit run and enable external networking only for
its targeted invocation, for example:

```shell
npx cross-env VITEST_ALLOW_EXTERNAL_NETWORK=1 vitest run path/to/integration.test.ts -t "test name"
```

The opt-in applies to that entire Vitest process, so do not set it for the regular unit suite.

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/).
For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/)
or contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.
