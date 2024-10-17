/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare global {
    declare module '*.ejs' {
        const template = <T>(data: T): string => '';
        export default template;
    }

    declare var __webpack_public_path__: string;
}
