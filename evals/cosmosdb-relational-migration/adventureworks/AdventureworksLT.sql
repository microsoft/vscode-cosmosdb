-- AdventureWorks Database Schema
-- Generated: 2026-03-11 23:28:12

USE [AdventureWorks]
GO

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET NUMERIC_ROUNDABORT OFF;
GO

IF SCHEMA_ID(N'SalesLT') IS NULL
    EXEC(N'CREATE SCHEMA [SalesLT] AUTHORIZATION [dbo]');
GO

IF TYPE_ID(N'dbo.Name') IS NULL
    EXEC(N'CREATE TYPE [dbo].[Name] FROM NVARCHAR(50) NULL');
GO

IF TYPE_ID(N'dbo.NameStyle') IS NULL
    EXEC(N'CREATE TYPE [dbo].[NameStyle] FROM BIT NOT NULL');
GO

IF TYPE_ID(N'dbo.Phone') IS NULL
    EXEC(N'CREATE TYPE [dbo].[Phone] FROM NVARCHAR(25) NULL');
GO

IF TYPE_ID(N'dbo.Flag') IS NULL
    EXEC(N'CREATE TYPE [dbo].[Flag] FROM BIT NOT NULL');
GO

IF TYPE_ID(N'dbo.AccountNumber') IS NULL
    EXEC(N'CREATE TYPE [dbo].[AccountNumber] FROM NVARCHAR(15) NULL');
GO

IF TYPE_ID(N'dbo.OrderNumber') IS NULL
    EXEC(N'CREATE TYPE [dbo].[OrderNumber] FROM NVARCHAR(25) NULL');
GO

CREATE SEQUENCE [SalesLT].[SalesOrderNumber]
    AS INT
    START WITH 1
    INCREMENT BY 1;
GO

CREATE TABLE [dbo].[BuildVersion] (
    [SystemInformationID] TINYINT IDENTITY(1,1) NOT NULL,
    [Database Version] NVARCHAR(25) NOT NULL,
    [VersionDate] DATETIME NOT NULL,
    [ModifiedDate] DATETIME DEFAULT (getdate()) NOT NULL,
    CONSTRAINT [PK_BuildVersion_SystemInformationID] PRIMARY KEY ([SystemInformationID])
);
GO

CREATE TABLE [dbo].[ErrorLog] (
    [ErrorLogID] INT IDENTITY(1,1) NOT NULL,
    [ErrorTime] DATETIME DEFAULT (getdate()) NOT NULL,
    [ErrorNumber] INT NOT NULL,
    [ErrorSeverity] INT NULL,
    [ErrorState] INT NULL,
    [ErrorProcedure] NVARCHAR(126) NULL,
    [ErrorLine] INT NULL,
    [ErrorMessage] NVARCHAR(4000) NOT NULL,
    CONSTRAINT [PK_ErrorLog_ErrorLogID] PRIMARY KEY ([ErrorLogID])
);
GO

CREATE TABLE [SalesLT].[Address] (
    [AddressID] INT IDENTITY(1,1) NOT NULL,
    [AddressLine1] NVARCHAR(60) NOT NULL,
    [AddressLine2] NVARCHAR(60) NULL,
    [City] NVARCHAR(30) NOT NULL,
    [StateProvince] [dbo].[Name] NOT NULL,
    [CountryRegion] [dbo].[Name] NOT NULL,
    [PostalCode] NVARCHAR(15) NOT NULL,
    [rowguid] UNIQUEIDENTIFIER DEFAULT (newid()) NOT NULL,
    [ModifiedDate] DATETIME DEFAULT (getdate()) NOT NULL,
    CONSTRAINT [PK_Address_AddressID] PRIMARY KEY ([AddressID])
);
GO

CREATE TABLE [SalesLT].[Customer] (
    [CustomerID] INT IDENTITY(1,1) NOT NULL,
    [NameStyle] [dbo].[NameStyle] DEFAULT ((0)) NOT NULL,
    [Title] NVARCHAR(8) NULL,
    [FirstName] [dbo].[Name] NOT NULL,
    [MiddleName] [dbo].[Name] NULL,
    [LastName] [dbo].[Name] NOT NULL,
    [Suffix] NVARCHAR(10) NULL,
    [CompanyName] NVARCHAR(128) NULL,
    [SalesPerson] NVARCHAR(256) NULL,
    [EmailAddress] NVARCHAR(50) NULL,
    [Phone] [dbo].[Phone] NULL,
    [PasswordHash] VARCHAR(128) NOT NULL,
    [PasswordSalt] VARCHAR(10) NOT NULL,
    [rowguid] UNIQUEIDENTIFIER DEFAULT (newid()) NOT NULL,
    [ModifiedDate] DATETIME DEFAULT (getdate()) NOT NULL,
    CONSTRAINT [PK_Customer_CustomerID] PRIMARY KEY ([CustomerID])
);
GO

CREATE TABLE [SalesLT].[CustomerAddress] (
    [CustomerID] INT NOT NULL,
    [AddressID] INT NOT NULL,
    [AddressType] [dbo].[Name] NOT NULL,
    [rowguid] UNIQUEIDENTIFIER DEFAULT (newid()) NOT NULL,
    [ModifiedDate] DATETIME DEFAULT (getdate()) NOT NULL,
    CONSTRAINT [PK_CustomerAddress_CustomerID_AddressID] PRIMARY KEY ([CustomerID], [AddressID])
);
GO

CREATE TABLE [SalesLT].[Product] (
    [ProductID] INT IDENTITY(1,1) NOT NULL,
    [Name] [dbo].[Name] NOT NULL,
    [ProductNumber] NVARCHAR(25) NOT NULL,
    [Color] NVARCHAR(15) NULL,
    [StandardCost] MONEY NOT NULL,
    [ListPrice] MONEY NOT NULL,
    [Size] NVARCHAR(5) NULL,
    [Weight] DECIMAL(8, 2) NULL,
    [ProductCategoryID] INT NULL,
    [ProductModelID] INT NULL,
    [SellStartDate] DATETIME NOT NULL,
    [SellEndDate] DATETIME NULL,
    [DiscontinuedDate] DATETIME NULL,
    [ThumbNailPhoto] VARBINARY(MAX) NULL,
    [ThumbnailPhotoFileName] NVARCHAR(50) NULL,
    [rowguid] UNIQUEIDENTIFIER DEFAULT (newid()) NOT NULL,
    [ModifiedDate] DATETIME DEFAULT (getdate()) NOT NULL,
    CONSTRAINT [PK_Product_ProductID] PRIMARY KEY ([ProductID])
);
GO

CREATE TABLE [SalesLT].[ProductCategory] (
    [ProductCategoryID] INT IDENTITY(1,1) NOT NULL,
    [ParentProductCategoryID] INT NULL,
    [Name] [dbo].[Name] NOT NULL,
    [rowguid] UNIQUEIDENTIFIER DEFAULT (newid()) NOT NULL,
    [ModifiedDate] DATETIME DEFAULT (getdate()) NOT NULL,
    CONSTRAINT [PK_ProductCategory_ProductCategoryID] PRIMARY KEY ([ProductCategoryID])
);
GO

CREATE TABLE [SalesLT].[ProductDescription] (
    [ProductDescriptionID] INT IDENTITY(1,1) NOT NULL,
    [Description] NVARCHAR(400) NOT NULL,
    [rowguid] UNIQUEIDENTIFIER DEFAULT (newid()) NOT NULL,
    [ModifiedDate] DATETIME DEFAULT (getdate()) NOT NULL,
    CONSTRAINT [PK_ProductDescription_ProductDescriptionID] PRIMARY KEY ([ProductDescriptionID])
);
GO

CREATE TABLE [SalesLT].[ProductModel] (
    [ProductModelID] INT IDENTITY(1,1) NOT NULL,
    [Name] [dbo].[Name] NOT NULL,
    [CatalogDescription] XML NULL,
    [rowguid] UNIQUEIDENTIFIER DEFAULT (newid()) NOT NULL,
    [ModifiedDate] DATETIME DEFAULT (getdate()) NOT NULL,
    CONSTRAINT [PK_ProductModel_ProductModelID] PRIMARY KEY ([ProductModelID])
);
GO

CREATE TABLE [SalesLT].[ProductModelProductDescription] (
    [ProductModelID] INT NOT NULL,
    [ProductDescriptionID] INT NOT NULL,
    [Culture] NVARCHAR(6) NOT NULL,
    [rowguid] UNIQUEIDENTIFIER DEFAULT (newid()) NOT NULL,
    [ModifiedDate] DATETIME DEFAULT (getdate()) NOT NULL,
    CONSTRAINT [PK_ProductModelProductDescription_ProductModelID_ProductDescriptionID_Culture] PRIMARY KEY ([ProductModelID], [ProductDescriptionID], [Culture])
);
GO

CREATE TABLE [SalesLT].[SalesOrderDetail] (
    [SalesOrderID] INT NOT NULL,
    [SalesOrderDetailID] INT IDENTITY(1,1) NOT NULL,
    [OrderQty] SMALLINT NOT NULL,
    [ProductID] INT NOT NULL,
    [UnitPrice] MONEY NOT NULL,
    [UnitPriceDiscount] MONEY DEFAULT ((0.0)) NOT NULL,
    [LineTotal] AS (isnull(([UnitPrice]*((1.0)-[UnitPriceDiscount]))*[OrderQty],(0.0))),
    [rowguid] UNIQUEIDENTIFIER DEFAULT (newid()) NOT NULL,
    [ModifiedDate] DATETIME DEFAULT (getdate()) NOT NULL,
    CONSTRAINT [PK_SalesOrderDetail_SalesOrderID_SalesOrderDetailID] PRIMARY KEY ([SalesOrderID], [SalesOrderDetailID])
);
GO

CREATE TABLE [SalesLT].[SalesOrderHeader] (
    [SalesOrderID] INT DEFAULT (NEXT VALUE FOR [SalesLT].[SalesOrderNumber]) NOT NULL,
    [RevisionNumber] TINYINT DEFAULT ((0)) NOT NULL,
    [OrderDate] DATETIME DEFAULT (getdate()) NOT NULL,
    [DueDate] DATETIME NOT NULL,
    [ShipDate] DATETIME NULL,
    [Status] TINYINT DEFAULT ((1)) NOT NULL,
    [OnlineOrderFlag] [dbo].[Flag] DEFAULT ((1)) NOT NULL,
    [SalesOrderNumber] AS (isnull(N'SO'+CONVERT([nvarchar](23),[SalesOrderID],(0)),N'*** ERROR ***')),
    [PurchaseOrderNumber] [dbo].[OrderNumber] NULL,
    [AccountNumber] [dbo].[AccountNumber] NULL,
    [CustomerID] INT NOT NULL,
    [ShipToAddressID] INT NULL,
    [BillToAddressID] INT NULL,
    [ShipMethod] NVARCHAR(50) NOT NULL,
    [CreditCardApprovalCode] VARCHAR(15) NULL,
    [SubTotal] MONEY DEFAULT ((0.00)) NOT NULL,
    [TaxAmt] MONEY DEFAULT ((0.00)) NOT NULL,
    [Freight] MONEY DEFAULT ((0.00)) NOT NULL,
    [TotalDue] AS (isnull(([SubTotal]+[TaxAmt])+[Freight],(0))),
    [Comment] NVARCHAR(MAX) NULL,
    [rowguid] UNIQUEIDENTIFIER DEFAULT (newid()) NOT NULL,
    [ModifiedDate] DATETIME DEFAULT (getdate()) NOT NULL,
    CONSTRAINT [PK_SalesOrderHeader_SalesOrderID] PRIMARY KEY ([SalesOrderID])
);
GO

-- Foreign Key Constraints

ALTER TABLE [SalesLT].[CustomerAddress]
    ADD CONSTRAINT [FK_CustomerAddress_Address_AddressID]
    FOREIGN KEY ([AddressID])
    REFERENCES [SalesLT].[Address] ([AddressID]);
GO

ALTER TABLE [SalesLT].[CustomerAddress]
    ADD CONSTRAINT [FK_CustomerAddress_Customer_CustomerID]
    FOREIGN KEY ([CustomerID])
    REFERENCES [SalesLT].[Customer] ([CustomerID]);
GO

ALTER TABLE [SalesLT].[Product]
    ADD CONSTRAINT [FK_Product_ProductCategory_ProductCategoryID]
    FOREIGN KEY ([ProductCategoryID])
    REFERENCES [SalesLT].[ProductCategory] ([ProductCategoryID]);
GO

ALTER TABLE [SalesLT].[Product]
    ADD CONSTRAINT [FK_Product_ProductModel_ProductModelID]
    FOREIGN KEY ([ProductModelID])
    REFERENCES [SalesLT].[ProductModel] ([ProductModelID]);
GO

ALTER TABLE [SalesLT].[ProductCategory]
    ADD CONSTRAINT [FK_ProductCategory_ProductCategory_ParentProductCategoryID_ProductCategoryID]
    FOREIGN KEY ([ParentProductCategoryID])
    REFERENCES [SalesLT].[ProductCategory] ([ProductCategoryID]);
GO

ALTER TABLE [SalesLT].[ProductModelProductDescription]
    ADD CONSTRAINT [FK_ProductModelProductDescription_ProductDescription_ProductDescriptionID]
    FOREIGN KEY ([ProductDescriptionID])
    REFERENCES [SalesLT].[ProductDescription] ([ProductDescriptionID]);
GO

ALTER TABLE [SalesLT].[ProductModelProductDescription]
    ADD CONSTRAINT [FK_ProductModelProductDescription_ProductModel_ProductModelID]
    FOREIGN KEY ([ProductModelID])
    REFERENCES [SalesLT].[ProductModel] ([ProductModelID]);
GO

ALTER TABLE [SalesLT].[SalesOrderDetail]
    ADD CONSTRAINT [FK_SalesOrderDetail_Product_ProductID]
    FOREIGN KEY ([ProductID])
    REFERENCES [SalesLT].[Product] ([ProductID]);
GO

ALTER TABLE [SalesLT].[SalesOrderDetail]
    ADD CONSTRAINT [FK_SalesOrderDetail_SalesOrderHeader_SalesOrderID]
    FOREIGN KEY ([SalesOrderID])
    REFERENCES [SalesLT].[SalesOrderHeader] ([SalesOrderID])
    ON DELETE CASCADE;
GO

ALTER TABLE [SalesLT].[SalesOrderHeader]
    ADD CONSTRAINT [FK_SalesOrderHeader_Address_BillTo_AddressID]
    FOREIGN KEY ([BillToAddressID])
    REFERENCES [SalesLT].[Address] ([AddressID]);
GO

ALTER TABLE [SalesLT].[SalesOrderHeader]
    ADD CONSTRAINT [FK_SalesOrderHeader_Address_ShipTo_AddressID]
    FOREIGN KEY ([ShipToAddressID])
    REFERENCES [SalesLT].[Address] ([AddressID]);
GO

ALTER TABLE [SalesLT].[SalesOrderHeader]
    ADD CONSTRAINT [FK_SalesOrderHeader_Customer_CustomerID]
    FOREIGN KEY ([CustomerID])
    REFERENCES [SalesLT].[Customer] ([CustomerID]);
GO

CREATE UNIQUE INDEX [AK_Address_rowguid]
    ON [SalesLT].[Address] ([rowguid]);
GO

CREATE INDEX [IX_Address_StateProvince]
    ON [SalesLT].[Address] ([StateProvince]);
GO

CREATE INDEX [IX_Address_AddressLine1_AddressLine2_City_StateProvince_PostalCode_CountryRegion]
    ON [SalesLT].[Address] ([AddressLine1], [AddressLine2], [City], [StateProvince], [PostalCode], [CountryRegion]);
GO

CREATE INDEX [IX_Customer_EmailAddress]
    ON [SalesLT].[Customer] ([EmailAddress]);
GO

CREATE UNIQUE INDEX [AK_Customer_rowguid]
    ON [SalesLT].[Customer] ([rowguid]);
GO

CREATE UNIQUE INDEX [AK_CustomerAddress_rowguid]
    ON [SalesLT].[CustomerAddress] ([rowguid]);
GO

CREATE INDEX [IX_CustomerAddress_AddressID]
    ON [SalesLT].[CustomerAddress] ([AddressID]);
GO

CREATE UNIQUE INDEX [AK_Product_Name]
    ON [SalesLT].[Product] ([Name]);
GO

CREATE UNIQUE INDEX [AK_Product_ProductNumber]
    ON [SalesLT].[Product] ([ProductNumber]);
GO

CREATE UNIQUE INDEX [AK_Product_rowguid]
    ON [SalesLT].[Product] ([rowguid]);
GO

CREATE INDEX [IX_Product_ProductCategoryID]
    ON [SalesLT].[Product] ([ProductCategoryID]);
GO

CREATE INDEX [IX_Product_ProductModelID]
    ON [SalesLT].[Product] ([ProductModelID]);
GO

CREATE UNIQUE INDEX [AK_ProductCategory_Name]
    ON [SalesLT].[ProductCategory] ([Name]);
GO

CREATE UNIQUE INDEX [AK_ProductCategory_rowguid]
    ON [SalesLT].[ProductCategory] ([rowguid]);
GO

CREATE INDEX [IX_ProductCategory_ParentProductCategoryID]
    ON [SalesLT].[ProductCategory] ([ParentProductCategoryID]);
GO

CREATE UNIQUE INDEX [AK_ProductDescription_rowguid]
    ON [SalesLT].[ProductDescription] ([rowguid]);
GO

CREATE UNIQUE INDEX [AK_ProductModel_Name]
    ON [SalesLT].[ProductModel] ([Name]);
GO

CREATE UNIQUE INDEX [AK_ProductModel_rowguid]
    ON [SalesLT].[ProductModel] ([rowguid]);
GO

CREATE UNIQUE INDEX [AK_ProductModelProductDescription_rowguid]
    ON [SalesLT].[ProductModelProductDescription] ([rowguid]);
GO

CREATE INDEX [IX_ProductModelProductDescription_ProductDescriptionID]
    ON [SalesLT].[ProductModelProductDescription] ([ProductDescriptionID]);
GO

CREATE INDEX [IX_SalesOrderDetail_ProductID]
    ON [SalesLT].[SalesOrderDetail] ([ProductID]);
GO

CREATE UNIQUE INDEX [AK_SalesOrderDetail_rowguid]
    ON [SalesLT].[SalesOrderDetail] ([rowguid]);
GO

CREATE INDEX [IX_SalesOrderHeader_CustomerID]
    ON [SalesLT].[SalesOrderHeader] ([CustomerID]);
GO

CREATE UNIQUE INDEX [AK_SalesOrderHeader_rowguid]
    ON [SalesLT].[SalesOrderHeader] ([rowguid]);
GO

CREATE UNIQUE INDEX [AK_SalesOrderHeader_SalesOrderNumber]
    ON [SalesLT].[SalesOrderHeader] ([SalesOrderNumber]);
GO

CREATE INDEX [IX_SalesOrderHeader_BillToAddressID]
    ON [SalesLT].[SalesOrderHeader] ([BillToAddressID]);
GO

CREATE INDEX [IX_SalesOrderHeader_ShipToAddressID]
    ON [SalesLT].[SalesOrderHeader] ([ShipToAddressID]);
GO
