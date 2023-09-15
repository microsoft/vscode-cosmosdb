# Connecting to PostgreSQL Flexible database servers using Azure Active Directory

> [!NOTE]
> Azure Active Directory is becoming Microsoft Entra ID.

Passwords and secret keys should be used with caution, and developers must never place them in an unsecure location. Microsoft encourages developers to use Azure Active Directory (Azure AD) to connect their applications with Azure services so they don't need to keep the passwords with their application. PostgreSQL Flexible database servers on Azure now supports authentication using Azure AD and you can start migrating your connections to it to reduce the security risk imposed by using passwords.

# Enable Azure AD authentication for PostgreSQL Flexible database servers

## Enable Azure AD

On Azure Portal, go to the PostgreSQL Flexible database server page and expand the "Authentication" blade under "Security". In the "Authentication" blade, set "Assign Access to" option to "PostgreSQL and Azure Active Directory authentication".

> [!Note]
> While you can disable PostgreSQL authentication right away, it's recommended to enable both authentication methods until you finish migrating all the resources.

Click "Save" and wait for the deployment to finish.

## Configure Azure AD roles for both your application and user account

After enabling Azure AD authentication, click "Add Azure AD Admins" to add an Azure AD Admin user to the database server. Only Azure AD Admin users can add Azure AD users. Once you added the Azure AD Admin user, you can connect to the database server as that user to add non-admin Azure AD users for those who only need non-admin access to the database. The Azure AD user can be either your Azure user account or a service principal used by your application.

Learn more at [manage Azure AD users](https://learn.microsoft.com/en-us/azure/postgresql/flexible-server/how-to-manage-azure-ad-users#manage-azure-ad-roles-using-sql)

## Transfer ownership of resources

Resources in PostgreSQL databases have owners. If you have a database created by your old PostgreSQL role using username and password, chances are that its owner is your old PostgreSQL role. Some operations can only performed by the owner. If you want to stop using your old PostgreSQL roles with username and password but keep all existing resources, you need to transfer the ownership of those resources to the new Azure AD user. This is why we recommend you to keep the old PostgreSQL user until you are confident that all your resources are transferred to the new Azure AD users.

Each Azure AD user has a mapped PostgreSQL role. You can connect to the database and use the `\du` command Transferring the ownership of a resources can be achieved by setting that mapped role as the owner of the resource. To do that, you can connect to the the database using your old PostgreSQL username and password and then use ALTER command to transfer the owner to the mapped Azure AD role. Once you are confident that all the resources can be accessed by the new Azure AD users, you may disable authentication using password.

## Test your migration in Azure Database extension

An easy way to test the authentication configuration is to give your user account the same privileges that you plan to give to the service principal of your application. The Azure Database extension will now attempt to use the Azure AD credential of your signed-in user account to connect to the PostgreSQL Flexible database servers and run queries. It will automatically fallback to use the password stored with the database server to authenticate if Azure AD authentication fails. When the extension falls back to use password, an inline action will be displayed indicating that you are using the password. You can connect to your database server, run queries that you plan to run in your application and test to see if everything works as expected.

> [!Note]
> Azure Database Extension only supports authenticating with PostgreSQL Flexible database servers in the signed-in user's default tenant. It doesn't support authenticating with database servers in guest tenants and it doesn't support authenticating with database servers attached using connection string.
