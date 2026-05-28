/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * User-facing install/repair flow for the CosmosDBShell `dotnet tool` package
 * and its .NET SDK prerequisite.
 *
 * All prompts emit a `cosmosDB.cosmosDBShell.install.prompt` telemetry event so the
 * install funnel can be measured without depending on (localized) button labels.
 *
 * A `launchShell` callback is injected to avoid a circular dependency with the
 * main extension module that owns the actual launch flow.
 */
import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as child from 'child_process';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { type NoSqlContainerResourceItem } from '../../tree/nosql/NoSqlContainerResourceItem';
import { isCosmosDBShellPathFound } from '../shellCommand';
import { isCosmosDBShellInstalled } from '../shellSupportCache';
import { MIN_DOTNET_SDK_VERSION, hasRequiredDotNetSdk, tryInstallDotNetSdkViaExtension } from './dotNetSdk';

/** Callback signature used by the install flow to resume the original launch action after install. */
export type LaunchShellFn = (context: IActionContext, node: NoSqlContainerResourceItem | undefined) => Promise<void>;

/**
 * Runs `dotnet tool install --global CosmosDBShell --prerelease` with a progress
 * notification, streaming output to the extension output channel. Returns true
 * when the process exits with code 0.
 */
async function installCosmosDBShellWithDotNetTool(dotnetPath?: string): Promise<boolean> {
    const result = await callWithTelemetryAndErrorHandling(
        'cosmosDB.cosmosDBShell.install.tool',
        async (telemetryContext: IActionContext) => {
            telemetryContext.errorHandling.suppressDisplay = true;
            telemetryContext.telemetry.properties.dotnetPathProvided = String(!!dotnetPath);
            const startedAt = Date.now();
            const outcome = await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: l10n.t('Installing Cosmos DB Shell…'),
                    cancellable: true,
                },
                async (_progress, token) => {
                    ext.outputChannel.show(true);
                    const dotnetExe = dotnetPath ?? 'dotnet';
                    ext.outputChannel.appendLine(`> ${dotnetExe} tool install --global CosmosDBShell --prerelease`);

                    return new Promise<{ success: boolean; exitCode: number | null; cancelled: boolean }>((resolve) => {
                        let cancelled = false;
                        const proc = child.spawn(
                            dotnetExe,
                            ['tool', 'install', '--global', 'CosmosDBShell', '--prerelease'],
                            { windowsHide: true, shell: false },
                        );

                        token.onCancellationRequested(() => {
                            cancelled = true;
                            proc.kill();
                        });

                        proc.stdout?.on('data', (data: Buffer) => {
                            ext.outputChannel.append(data.toString('utf8'));
                        });
                        proc.stderr?.on('data', (data: Buffer) => {
                            ext.outputChannel.append(data.toString('utf8'));
                        });
                        proc.on('error', (err) => {
                            ext.outputChannel.appendLine(`Failed to start dotnet: ${err.message}`);
                            resolve({ success: false, exitCode: null, cancelled });
                        });
                        proc.on('close', (code) => {
                            ext.outputChannel.appendLine(`\nProcess exited with code ${code}.`);
                            resolve({ success: code === 0, exitCode: code, cancelled });
                        });
                    });
                },
            );
            telemetryContext.telemetry.measurements.durationMs = Date.now() - startedAt;
            telemetryContext.telemetry.properties.exitCode =
                outcome.exitCode === null ? 'null' : String(outcome.exitCode);
            telemetryContext.telemetry.properties.cancelled = String(outcome.cancelled);
            telemetryContext.telemetry.properties.outcome = outcome.cancelled
                ? 'cancelled'
                : outcome.success
                  ? 'success'
                  : 'failure';
            return outcome.success;
        },
    );
    return result ?? false;
}

/**
 * Fires a `cosmosDB.cosmosDBShell.install.prompt` telemetry event with the
 * given prompt identifier and user selection. Used to measure the install
 * funnel without depending on localized button labels.
 */
function reportInstallPromptOutcome(
    promptKind:
        | 'missingShell'
        | 'installShell'
        | 'installSdk'
        | 'pathMisconfigured'
        | 'reloadAfterInstall'
        | 'installFailure',
    selection: string,
    extraProperties?: Record<string, string>,
): void {
    void callWithTelemetryAndErrorHandling(
        'cosmosDB.cosmosDBShell.install.prompt',
        (telemetryContext: IActionContext) => {
            telemetryContext.errorHandling.suppressDisplay = true;
            telemetryContext.telemetry.properties.promptKind = promptKind;
            telemetryContext.telemetry.properties.selection = selection;
            if (extraProperties) {
                for (const [k, v] of Object.entries(extraProperties)) {
                    telemetryContext.telemetry.properties[k] = v;
                }
            }
        },
    );
}

/**
 * Prompts the user to install Cosmos DB Shell via `dotnet tool install`, and on
 * success automatically continues the original launch flow.
 */
async function promptToInstallCosmosDBShell(
    context: IActionContext,
    node: NoSqlContainerResourceItem | undefined,
    launchShell: LaunchShellFn,
): Promise<void> {
    const install = l10n.t('Install');
    const settings = l10n.t('Settings');
    const selection = await vscode.window.showInformationMessage(
        l10n.t(
            'Cosmos DB Shell is not installed. Install it now using `dotnet tool install --global CosmosDBShell --prerelease`?',
        ),
        { modal: true },
        install,
        settings,
    );

    const outcome = selection === install ? 'install' : selection === settings ? 'settings' : 'cancelled';
    reportInstallPromptOutcome('installShell', outcome);

    if (selection === settings) {
        void vscode.commands.executeCommand('workbench.action.openSettings', 'cosmosDB.shell.path');
        return;
    }
    if (selection !== install) {
        return;
    }

    await installAndLaunchCosmosDBShell(context, node, launchShell);
}

/**
 * Runs the `dotnet tool install` for Cosmos DB Shell, then either reloads the window
 * (if PATH hasn't picked up the new tool yet) or auto-launches the shell to continue
 * the user's original action. Used both by the explicit install prompt and by the
 * auto-chain after a fresh .NET SDK acquisition.
 */
async function installAndLaunchCosmosDBShell(
    context: IActionContext,
    node: NoSqlContainerResourceItem | undefined,
    launchShell: LaunchShellFn,
    dotnetPath?: string,
): Promise<void> {
    const success = await installCosmosDBShellWithDotNetTool(dotnetPath);
    if (!success) {
        const showOutput = l10n.t('Show Output');
        const failureSelection = await vscode.window.showErrorMessage(
            l10n.t('Failed to install Cosmos DB Shell. See the output for details.'),
            showOutput,
        );
        reportInstallPromptOutcome('installFailure', failureSelection === showOutput ? 'showOutput' : 'dismissed');
        if (failureSelection === showOutput) {
            ext.outputChannel.show(true);
        }
        return;
    }

    // On a brand-new install the user's PATH may not yet include `~/.dotnet/tools`
    // in the current VS Code session. If we still can't resolve the shell, ask to reload.
    if (!isCosmosDBShellInstalled()) {
        const reload = l10n.t('Reload Window');
        const reloadSelection = await vscode.window.showInformationMessage(
            l10n.t(
                'Cosmos DB Shell was installed, but its location is not yet on PATH for this VS Code window. Reload the window to pick it up.',
            ),
            reload,
        );
        reportInstallPromptOutcome('reloadAfterInstall', reloadSelection === reload ? 'reload' : 'cancelled');
        if (reloadSelection === reload) {
            void vscode.commands.executeCommand('workbench.action.reloadWindow');
        }
        return;
    }

    // Auto-relaunch with the original node so the user lands where they intended.
    await launchShell(context, node);
}

async function promptToInstallDotNetSdk(
    context: IActionContext,
    node: NoSqlContainerResourceItem | undefined,
    launchShell: LaunchShellFn,
): Promise<void> {
    const installDotNetSdk = l10n.t('Install .NET SDK');
    const installDotNetTool = l10n.t('Install .NET Install Tool');
    const downloadDotNet = l10n.t('Download .NET SDK');
    const settings = l10n.t('Settings');
    const dotNetInstallToolExtensionId = 'ms-dotnettools.vscode-dotnet-runtime';
    const isDotNetInstallToolInstalled = !!vscode.extensions.getExtension(dotNetInstallToolExtensionId);
    const primaryAction = isDotNetInstallToolInstalled ? installDotNetSdk : installDotNetTool;
    const selection = await vscode.window.showInformationMessage(
        l10n.t(
            '.NET SDK {0} or newer is required to install Cosmos DB Shell. Install the .NET SDK, download it manually, or configure an existing Cosmos DB Shell path in settings.',
            MIN_DOTNET_SDK_VERSION,
        ),
        { modal: true },
        primaryAction,
        downloadDotNet,
        settings,
    );

    const outcome =
        selection === installDotNetSdk
            ? 'installSdk'
            : selection === installDotNetTool
              ? 'installTool'
              : selection === downloadDotNet
                ? 'downloadSdk'
                : selection === settings
                  ? 'settings'
                  : 'cancelled';
    reportInstallPromptOutcome('installSdk', outcome, {
        installToolPresent: String(isDotNetInstallToolInstalled),
    });

    if (selection === installDotNetSdk) {
        const dotnetPath = await tryInstallDotNetSdkViaExtension();
        if (dotnetPath && hasRequiredDotNetSdk(dotnetPath)) {
            // Chain forward: now that the SDK is available, automatically continue with the
            // Cosmos DB Shell install using the freshly-acquired dotnet path so we don't have
            // to wait for PATH to be picked up by this VS Code session.
            await installAndLaunchCosmosDBShell(context, node, launchShell, dotnetPath);
        } else if (hasRequiredDotNetSdk()) {
            await promptToInstallCosmosDBShell(context, node, launchShell);
        } else {
            const showOutput = l10n.t('Show Output');
            const failureSelection = await vscode.window.showErrorMessage(
                l10n.t(
                    'Failed to install .NET SDK {0} or newer. Try downloading it manually from https://dot.net/download.',
                    MIN_DOTNET_SDK_VERSION,
                ),
                showOutput,
            );
            if (failureSelection === showOutput) {
                ext.outputChannel.show(true);
            }
        }
    } else if (selection === installDotNetTool) {
        void vscode.commands.executeCommand('workbench.extensions.installExtension', dotNetInstallToolExtensionId);
    } else if (selection === downloadDotNet) {
        void vscode.env.openExternal(vscode.Uri.parse('https://dot.net/download'));
    } else if (selection === settings) {
        void vscode.commands.executeCommand('workbench.action.openSettings', 'cosmosDB.shell.path');
    }
}

/**
 * Top-level entry point: when the launch flow discovers the shell isn't installed,
 * branches to the appropriate prompt depending on whether the configured path is
 * broken, the .NET SDK is missing, or just the tool itself is missing.
 */
export async function promptToResolveMissingCosmosDBShell(
    context: IActionContext,
    node: NoSqlContainerResourceItem | undefined,
    launchShell: LaunchShellFn,
): Promise<void> {
    if (isCosmosDBShellPathFound()) {
        const settings = l10n.t('Settings');
        const selection = await vscode.window.showErrorMessage(
            l10n.t(
                'Cosmos DB Shell path is configured but the executable could not be run. Please verify the path in settings.',
            ),
            settings,
        );
        reportInstallPromptOutcome('pathMisconfigured', selection === settings ? 'settings' : 'cancelled');
        if (selection === settings) {
            void vscode.commands.executeCommand('workbench.action.openSettings', 'cosmosDB.shell.path');
        }
        return;
    }

    const sdkOk = hasRequiredDotNetSdk();
    reportInstallPromptOutcome('missingShell', sdkOk ? 'promptInstallShell' : 'promptInstallSdk', {
        sdkSatisfiesMin: String(sdkOk),
    });

    if (sdkOk) {
        await promptToInstallCosmosDBShell(context, node, launchShell);
    } else {
        await promptToInstallDotNetSdk(context, node, launchShell);
    }
}
