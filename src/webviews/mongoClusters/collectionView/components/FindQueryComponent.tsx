import { Button, Input } from '@fluentui/react-components';
import { PlayRegular, SearchFilled } from '@fluentui/react-icons';
import type { JSX } from 'react';
import { useContext, useRef } from 'react';
import { CollectionViewContext } from '../collectionViewContext';

export const FindQueryComponent = ({ onQueryUpdate }): JSX.Element => {
    const [currentContext] = useContext(CollectionViewContext);

    const inputField = useRef<HTMLInputElement>(null);

    function runQuery() {
        const queryText = inputField.current?.value ?? '{}';
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        onQueryUpdate(queryText);
    }

    return (
        <div className="findQueryComponent">
            <Input
                readOnly={currentContext.isLoading}
                ref={inputField}
                contentBefore={<SearchFilled />}
                style={{ flexGrow: 1 }}
                defaultValue="{  }"
                onKeyUp={(e) => {
                    if (e.key === 'Enter') {
                        runQuery();
                    }
                }}
            />
            <Button
                onClick={runQuery}
                disabled={currentContext.isLoading}
                icon={<PlayRegular />}
                appearance="primary"
                style={{ flexShrink: 0 }}
            >
                Find Query
            </Button>
        </div>
    );
};
