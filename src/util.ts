/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { reporter } from './telemetry';

export interface IDisposable {
	dispose(): void;
}

export function dispose<T extends IDisposable>(disposables: T[]): T[] {
	disposables.forEach(d => d.dispose());
	return [];
}

export function toDisposable(dispose: () => void): IDisposable {
	return { dispose };
}

// Telemetry for the extension
export function sendTelemetry(eventName: string, properties?: { [key: string]: string; }, measures?: { [key: string]: number; }) {
	if (reporter) {
		reporter.sendTelemetryEvent(eventName, properties, measures);
	}
}

export function errToString(error: any): string {
	if (error === null || error === undefined) {
		return '';
	}

	if (error instanceof Error) {
		return JSON.stringify({
			'Error': error.constructor.name,
			'Message': error.message
		});
	}

	if (typeof (error) === 'object') {
		return JSON.stringify({
			'object': error.constructor.name
		});
	}

	return error.toString();
}