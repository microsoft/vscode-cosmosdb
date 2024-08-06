import { useContext, useState } from 'react';
import { WebviewContext } from './WebviewContext';

export const CosmosDbQuery = () => {
    const { channel } = useContext(WebviewContext);
    const [bMessage, setBMessage] = useState<string>('');

    channel.on('ping', (payload) => {
        if (payload === 'PONG') {
            setBMessage('PONG');
        } else {
            setBMessage(`Something went wrong, the answer is ${payload}`);
        }
    });

    return (
        <div>
            <div style={{ display: 'flex' }}>
                <button
                    onClick={() => {
                        void channel.postMessage({
                            type: 'event',
                            name: 'sayHello',
                            params: ['Hello from CosmosDbQuery!'],
                        });
                    }}>
                    Say Hello!
                </button>
            </div>
            <div style={{ display: 'flex', marginTop: 10 }}>
                <button
                    onClick={() => {
                        void channel
                            .postMessage({
                                type: 'request',
                                name: 'ping',
                                params: ['PING'],
                            })
                            .then((response) => {
                                if (response === 'PONG') {
                                    setBMessage('PONG');
                                } else {
                                    setBMessage(`Something went wrong, the answer is ${response}`);
                                }
                            });
                        setBMessage('Pinging...');
                    }}>
                    Ping
                </button>
                <div>{bMessage}</div>
            </div>
        </div>
    );
};
