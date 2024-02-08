# Actions to expose to Azure Agent

## Create server

- NoSQL
- MongoDB
- Graph (is this still useful?)
- Azure Table
- PostgreSQL Flexible
- PostgreSQL Single

This requires refactoring the server creation to separate commands. Currently a top level quick pick decides which type of server to create, making the agent ux useless.

UX:

1. User instructs copilot chat to create a server of a known kind
2. Copilot chat calls the command to create server of that kind
3. Copilot auto skips all the parameters in the wizard
4. Copilot confirms with user
5. User fills all the real parameters and confirm
6. Execute the command

## Write a query

- PostgreSQL
- MongoDB
- NoSQL (todo)

UX:

1. User describes a query to be written with the type of database
2. There is no parameter to fill
3. Copilot confirms with user
4. Copilot calls the command to open a query editor with the query

## Create a stored procedure

- PostgreSQL
- MongoDB
- NoSQL (todo)

UX:

1. User describes what the stored procedure does
2. Copilot immediately realize it cannot fill the first parameter (subscription) since it does matter.
3. Copilot confirms with user
4. Copilot calls the command to select a database, creates a stored procedure, opens it in editor
5. Copilot prefills the editor with the generated stored procedure but doesn't save them (maybe save?)
