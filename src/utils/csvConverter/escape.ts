/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SettingsService } from '../../services/SettingsService';

/** Resolve the user-configured CSV separator, defaulting to ';'. */
export function getCsvSeparator(): string {
    return SettingsService.getSetting<string>('cosmosDB.csvSeparator') ?? ';';
}

/** Quote a CSV field and escape embedded double-quotes (RFC 4180). */
export const escapeCsvValue = (value: string): string => {
    return `"${value.replace(/"/g, '""')}"`;
};
