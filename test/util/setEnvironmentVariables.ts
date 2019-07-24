/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable } from "../../src/utils/vscodeUtils";

export function setEnvironmentVariables(env: { [key: string]: string }): IDisposable {
    let setRestoreEnv = new SetRestoreEnv();
    setRestoreEnv.set(env);
    return setRestoreEnv;
}

class SetRestoreEnv implements IDisposable {
    private _previousValues: { [key: string]: string } = {};

    public set(env: { [key: string]: string }): void {
        for (let key of Object.keys(env || {})) {
            [this._previousValues[key], process.env[key]] = [process.env[key], env[key]];
        }

    }

    public restore(): void {
        for (let key of Object.keys(this._previousValues)) {
            process.env[key] = this._previousValues[key];
        }
    }

    public dispose(): void {
        this.restore();
    }
}
