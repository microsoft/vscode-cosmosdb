/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Transport } from '../Transport/Transport';

export const isChannelPayload = (payload: unknown): payload is ChannelPayload => {
    return typeof payload === 'object' && payload !== null && 'type' in payload;
};

export type ChannelCallback<ReturnType = unknown> = (...payload: unknown[]) => ReturnType | Promise<ReturnType>;

export type ChannelPayload =
    | {
          type: 'event';
          name: string;
          params: unknown[];
      }
    | {
          type: 'request';
          name: string;
          params: unknown[];
      }
    | {
          type: 'response';
          value: unknown;
      }
    | {
          type: 'error';
          message: string;
      };

export interface ChannelMessage {
    id: string; // uuid to connect request and response
    payload: ChannelPayload;
}

// TODO: Ideally Channel should receive an API schema or API interface to check types
//  Also constructor should receive API implementation of schema or interface
export interface Channel {
    readonly name: string;
    readonly transport: Transport;

    postMessage<ReturnType = unknown>(message: ChannelMessage | ChannelPayload): PromiseLike<ReturnType>;
    on<ReturnType = unknown>(event: string, callback: ChannelCallback<ReturnType>): Channel;
    once<ReturnType = unknown>(event: string, callback: ChannelCallback<ReturnType>): Channel;
    off<ReturnType extends never>(event: string, callback: ChannelCallback<ReturnType>): Channel;
    removeAllListeners(event?: string): Channel;
    dispose(): void;
}
