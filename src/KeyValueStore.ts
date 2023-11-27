/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * A global key value store that associates tree nodes with open editors.
 */
export class KeyValueStore {
    private _items: Map<string, object>;

    private static _instance: KeyValueStore | undefined;

    public static get instance() {
        if (!this._instance) {
            this._instance = new KeyValueStore();
        }
        return this._instance;
    }

    /**
     * Prevent external instantiation.
     */
    private constructor() {
        this._items = new Map<string, object>();
    }

    public get(key: string): object | undefined {
        return this._items.get(key);
    }

    public set(key: string, value: object): void {
        this._items.set(key, value);
    }
}
