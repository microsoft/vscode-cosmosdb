import { Transport } from '../Transport/Transport';

export const isChannelPayload = (msg: unknown): msg is ChannelPayload => {
    return typeof msg === 'object' && msg !== null && 'type' in msg;
};

export type ChannelCallback<ReturnType extends any> = (payload: any[]) => ReturnType | Promise<ReturnType>;

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

    postMessage(message: ChannelMessage): PromiseLike<boolean>;
    on<ReturnType>(event: string, callback: ChannelCallback<ReturnType>): Channel;
    once<ReturnType>(event: string, callback: ChannelCallback<ReturnType>): Channel;
    off<ReturnType extends never>(event: string, callback: ChannelCallback<ReturnType>): Channel;
    dispose(): void;
}
