-- E2E seed schema for the Migration Assistant phase-flow tests.
-- Deterministic, minimal DDL so the (mocked) AI pipeline has schema input.

CREATE TABLE Orders (
    OrderID    INT          NOT NULL PRIMARY KEY,
    CustomerID INT          NOT NULL,
    OrderDate  DATETIME     NOT NULL,
    Total      DECIMAL(18,2) NOT NULL
);

CREATE TABLE OrderDetails (
    OrderDetailID INT          NOT NULL PRIMARY KEY,
    OrderID       INT          NOT NULL,
    ProductID     INT          NOT NULL,
    Quantity      INT          NOT NULL,
    UnitPrice     DECIMAL(18,2) NOT NULL,
    CONSTRAINT FK_OrderDetails_Orders FOREIGN KEY (OrderID) REFERENCES Orders (OrderID)
);
