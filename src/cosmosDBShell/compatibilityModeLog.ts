/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { ext } from '../extensionVariables';

type CompatibilityModeLogger = (installedVersion: string | undefined) => void;

export function createCompatibilityModeLogger(
    log: (message: string) => void = (message) => ext.outputChannel.info(message),
): CompatibilityModeLogger {
    let logged = false;

    return (installedVersion) => {
        if (logged) {
            return;
        }
        logged = true;

        log(
            installedVersion
                ? l10n.t(
                      'Cosmos DB Shell {0} does not support startup location arguments. Using escaped compatibility navigation.',
                      installedVersion,
                  )
                : l10n.t(
                      'The Cosmos DB Shell version could not be determined. Using escaped compatibility navigation.',
                  ),
        );
    };
}
