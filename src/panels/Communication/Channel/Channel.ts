import { Transport } from '../Transport/Transport';

export type ChannelPayload =
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
          code: string;
          message: string;
      }
    | {
          type: 'event';
          name: string;
          params: unknown[];
      };

export interface ChannelMessage {
    id: string; // uuid to connect request and response
    payload: ChannelPayload;
}

export interface Channel {
    readonly name: string;
    readonly transport: Transport;

    postMessage(message: ChannelMessage): Thenable<boolean>;
    on(event: string, callback: (message: ChannelMessage) => void): Channel;
    once(event: string, callback: (message: ChannelMessage) => void): Channel;
    off(event: string, callback: (message: ChannelMessage) => void): Channel;
    dispose(): void;
}
