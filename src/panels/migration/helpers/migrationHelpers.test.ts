/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { assignAccessPatternsToDomains, type ParsedAccessPattern } from './migrationHelpers';

const SAMPLE_ACCESS_PATTERNS: ParsedAccessPattern[] = [
    {
        name: 'AP-01: Lookup Person by ID',
        type: 'read',
        tables: ['Person.Person', 'Person.BusinessEntity'],
        frequency: 'high',
        codeReferences: [],
    },
    {
        name: 'AP-07: Address Lookup with State/Country',
        type: 'read',
        tables: ['Person.Address', 'Person.StateProvince', 'Person.CountryRegion'],
        frequency: 'high',
        codeReferences: ['Models/Address.cs'],
    },
    {
        name: 'AP-15: Product CRUD with Category and Model',
        type: 'read-write',
        tables: ['Production.Product', 'Production.ProductCategory', 'Production.ProductModel'],
        frequency: 'high',
        codeReferences: ['Controllers/ProductsController.cs', 'Models/Product.cs', 'Models/sampledbContext.cs'],
        sqlExample: 'SELECT p.ProductID, p.Name FROM Production.Product p WHERE p.ProductID = @ProductID;',
        codeExample: '_context.Product.Include(p => p.ProductCategory).Include(p => p.ProductModel).ToListAsync();',
    },
    {
        name: 'AP-33: Customer CRUD',
        type: 'read-write',
        tables: ['Sales.Customer'],
        frequency: 'high',
        codeReferences: ['Controllers/CustomersController.cs', 'Models/Customer.cs'],
        sqlExample: 'SELECT CustomerID, FirstName, LastName FROM Sales.Customer;',
        codeExample: '_context.Customer.ToListAsync();',
    },
];

describe('assignAccessPatternsToDomains', () => {
    const domains = [
        {
            name: 'PersonManagement',
            tables: [
                'Person.Person',
                'Person.BusinessEntity',
                'Person.Address',
                'Person.StateProvince',
                'Person.CountryRegion',
            ],
        },
        { name: 'Production', tables: ['Production.Product', 'Production.ProductCategory', 'Production.ProductModel'] },
        { name: 'Sales', tables: ['Sales.Customer', 'Sales.SalesOrderHeader'] },
    ];

    const result = assignAccessPatternsToDomains(domains, SAMPLE_ACCESS_PATTERNS);

    it('assigns patterns to correct domains', () => {
        const personDomain = result.find((d) => d.name === 'PersonManagement')!;
        const productionDomain = result.find((d) => d.name === 'Production')!;
        const salesDomain = result.find((d) => d.name === 'Sales')!;

        expect(personDomain.accessPatterns.map((p) => p.name)).toEqual([
            'AP-01: Lookup Person by ID',
            'AP-07: Address Lookup with State/Country',
        ]);
        expect(productionDomain.accessPatterns.map((p) => p.name)).toEqual([
            'AP-15: Product CRUD with Category and Model',
        ]);
        expect(salesDomain.accessPatterns.map((p) => p.name)).toEqual(['AP-33: Customer CRUD']);
    });

    it('preserves code references through assignment', () => {
        const productionDomain = result.find((d) => d.name === 'Production')!;
        expect(productionDomain.accessPatterns[0].codeReferences).toEqual([
            'Controllers/ProductsController.cs',
            'Models/Product.cs',
            'Models/sampledbContext.cs',
        ]);
    });

    it('matches tables case-insensitively', () => {
        const domainsLowerCase = [
            {
                name: 'Production',
                tables: ['production.product', 'production.productcategory', 'production.productmodel'],
            },
        ];
        const assigned = assignAccessPatternsToDomains(domainsLowerCase, SAMPLE_ACCESS_PATTERNS);
        expect(assigned[0].accessPatterns).toHaveLength(1);
        expect(assigned[0].accessPatterns[0].name).toBe('AP-15: Product CRUD with Category and Model');
    });
});
