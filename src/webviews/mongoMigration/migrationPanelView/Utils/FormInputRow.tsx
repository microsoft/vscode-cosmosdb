import { Field, Input, Link } from '@fluentui/react-components';
import React from 'react';

interface FormInputRowProps {
    id: string;
    label: string;
    required?: boolean;
    placeholder?: string;
    helpText?: string;
    link?: { href: string; text: string };
    children?: React.ReactNode;
    value?: string;
    onChange?: (val: string) => void;
    validationState?: 'error' | 'warning' | 'success';
    validationMessage?: string;
}

export const FormInputRow: React.FC<FormInputRowProps> = ({
    id,
    label,
    required = false,
    placeholder,
    helpText,
    link,
    children,
    value,
    onChange,
    validationState,
    validationMessage
}) => (
    <Field label={label} required={required} validationState={validationState} validationMessage={validationMessage}>
        {link && (
            <Link href={link.href} target="_blank" rel="noopener noreferrer">
                {link.text}
            </Link>
        )}
        {children ? (
            children
        ) : (
            <Input
                id={id}
                placeholder={placeholder}
                style={{ width: '50%' }}
                value={value}
                onChange={(e, data) => onChange?.(data.value)}
            />
        )}
    </Field>
);
