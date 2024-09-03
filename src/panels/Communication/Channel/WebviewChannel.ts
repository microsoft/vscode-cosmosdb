import  { type WebviewApi } from 'vscode-webview';
import { WebviewTransport } from '../Transport/WebviewTransport';
import { CommonChannel } from './CommonChannel';

export class WebviewChannel<StateType = unknown> extends CommonChannel {
    constructor(webviewApi: WebviewApi<StateType>) {
        const transport = new WebviewTransport(webviewApi);
        super('webview', transport);
    }

    dispose(): void {
        super.dispose();
        this.transport.dispose();
    }
}
