/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Client, ClientConfig } from "pg";
import { ConnectionOptions } from "tls";
import { postgresDefaultPort } from "../constants";
import { localize } from "../utils/localize";
import { nonNullProp } from "../utils/nonNull";
import { addDatabaseToConnectionString } from "./postgresConnectionStrings";
import { invalidCredentialsErrorType } from "./tree/PostgresDatabaseTreeItem";
import { PostgresServerTreeItem } from "./tree/PostgresServerTreeItem";

export async function getClientConfig(treeItem: PostgresServerTreeItem, databaseName: string): Promise<ClientConfig> {
    let clientConfig: ClientConfig;
    const parsedCS = await treeItem.getFullConnectionString();
    if (treeItem.azureName) {
        const username: string | undefined = parsedCS.username;
        const password: string | undefined = parsedCS.password;

        const sslAzure: ConnectionOptions = {
            // Always provide the certificate since it is accepted even when SSL is disabled
            // Certificate source: https://aka.ms/AA7wnvl
            ca: BaltimoreCyberTrustRoot
        };
        if ((username && password)) {
            const host = nonNullProp(parsedCS, 'hostName');
            const port: number = parsedCS.port ? parseInt(parsedCS.port) : parseInt(postgresDefaultPort);
            clientConfig = { user: username, password: password, ssl: sslAzure, host, port, database: databaseName };
        } else {
            throw {
                message: localize('mustEnterCredentials', 'Must enter credentials to connect to server.'),
                code: invalidCredentialsErrorType
            };
        }
    } else {
        let connectionString = parsedCS.connectionString;
        if (!parsedCS.databaseName) {
            connectionString = addDatabaseToConnectionString(connectionString, databaseName);
        }
        clientConfig = { connectionString: connectionString };
    }

    const client = new Client(clientConfig);
    // Ensure the client config is valid before returning
    try {
        await client.connect();
        return clientConfig;
    } finally {
        await client.end();
    }
}

export const BaltimoreCyberTrustRoot: string = `-----BEGIN CERTIFICATE-----
MIIDdzCCAl+gAwIBAgIEAgAAuTANBgkqhkiG9w0BAQUFADBaMQswCQYDVQQGEwJJ
RTESMBAGA1UEChMJQmFsdGltb3JlMRMwEQYDVQQLEwpDeWJlclRydXN0MSIwIAYD
VQQDExlCYWx0aW1vcmUgQ3liZXJUcnVzdCBSb290MB4XDTAwMDUxMjE4NDYwMFoX
DTI1MDUxMjIzNTkwMFowWjELMAkGA1UEBhMCSUUxEjAQBgNVBAoTCUJhbHRpbW9y
ZTETMBEGA1UECxMKQ3liZXJUcnVzdDEiMCAGA1UEAxMZQmFsdGltb3JlIEN5YmVy
VHJ1c3QgUm9vdDCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAKMEuyKr
mD1X6CZymrV51Cni4eiVgLGw41uOKymaZN+hXe2wCQVt2yguzmKiYv60iNoS6zjr
IZ3AQSsBUnuId9Mcj8e6uYi1agnnc+gRQKfRzMpijS3ljwumUNKoUMMo6vWrJYeK
mpYcqWe4PwzV9/lSEy/CG9VwcPCPwBLKBsua4dnKM3p31vjsufFoREJIE9LAwqSu
XmD+tqYF/LTdB1kC1FkYmGP1pWPgkAx9XbIGevOF6uvUA65ehD5f/xXtabz5OTZy
dc93Uk3zyZAsuT3lySNTPx8kmCFcB5kpvcY67Oduhjprl3RjM71oGDHweI12v/ye
jl0qhqdNkNwnGjkCAwEAAaNFMEMwHQYDVR0OBBYEFOWdWTCCR1jMrPoIVDaGezq1
BE3wMBIGA1UdEwEB/wQIMAYBAf8CAQMwDgYDVR0PAQH/BAQDAgEGMA0GCSqGSIb3
DQEBBQUAA4IBAQCFDF2O5G9RaEIFoN27TyclhAO992T9Ldcw46QQF+vaKSm2eT92
9hkTI7gQCvlYpNRhcL0EYWoSihfVCr3FvDB81ukMJY2GQE/szKN+OMY3EU/t3Wgx
jkzSswF07r51XgdIGn9w/xZchMB5hbgF/X++ZRGjD8ACtPhSNzkE1akxehi/oCr0
Epn3o0WC4zxe9Z2etciefC7IpJ5OCBRLbf1wbWsaY71k5h+3zvDyny67G7fyUIhz
ksLi4xaNmjICq44Y3ekQEe5+NauQrz4wlHrQMz2nZQ/1/I6eYs9HRCwBXbsdtTLS
R9I4LtD+gdwyah617jzV/OeBHRnDJELqYzmp
-----END CERTIFICATE-----`;
