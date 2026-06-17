/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export * from './WebviewContext';
export * from './useTrpcClient';

// Re-export the base router-shape type so consumers writing generic
// helpers around `TrpcClient<TRouter>` don't need to import directly
// from `@trpc/server` (purely a type — erased at runtime).
export type { AnyRouter } from '@trpc/server';
