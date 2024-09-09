import ConnectionString from 'mongodb-connection-string-url';

export const removePasswordFromConnectionString = (connectionString: string): string => {
    const connectionStringOb = new ConnectionString(connectionString);
    connectionStringOb.password = '';
    return connectionStringOb.toString();
};

export const addAuthenticationDataToConnectionString = (
    connectionString: string,
    username: string,
    password: string,
): string => {
    const connectionStringOb = new ConnectionString(connectionString);
    connectionStringOb.username = username;
    connectionStringOb.password = password;
    return connectionStringOb.toString();
};
