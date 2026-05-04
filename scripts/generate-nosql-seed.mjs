/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Generates deterministic seed data for the NoSQL parser integration test suite.
 *
 * Produces three containers, each 5-10 MB:
 *   products  — flat e-commerce catalogue (3 000 docs)
 *   orders    — nested objects + line-item arrays (2 500 docs)
 *   events    — sparse time-series (5 000 docs)
 *
 * Usage:
 *   node scripts/generate-nosql-seed.mjs --container products
 *   node scripts/generate-nosql-seed.mjs --container orders
 *   node scripts/generate-nosql-seed.mjs --container events
 *   node scripts/generate-nosql-seed.mjs --all
 *
 * Output: packages/nosql-language-service/src/test-fixtures/containers/<name>.seed.json
 *
 * Output is fully deterministic: every run with the same flags produces
 * identical bytes (PRNG seed = 42).
 */

import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(__dirname, '../packages/nosql-language-service/src/test-fixtures/containers');

// ========================== Deterministic PRNG (mulberry32) ===================

/**
 * Returns a seeded pseudo-random number generator.
 * mulberry32 by Tommy Ettinger — public domain.
 * Produces values in [0, 1).
 */
function createPrng(seed) {
    let s = seed >>> 0;
    return function rand() {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Create one PRNG per container so they are independent but still deterministic.
function makeHelpers(seed) {
    const rand = createPrng(seed);

    function int(min, max) {
        return Math.floor(rand() * (max - min + 1)) + min;
    }

    function float(min, max, dp = 2) {
        return parseFloat((rand() * (max - min) + min).toFixed(dp));
    }

    function bool(trueProbability = 0.5) {
        return rand() < trueProbability;
    }

    function pick(arr) {
        return arr[Math.floor(rand() * arr.length)];
    }

    function pickN(arr, n) {
        const copy = [...arr];
        const result = [];
        for (let i = 0; i < n && copy.length > 0; i++) {
            const idx = Math.floor(rand() * copy.length);
            result.push(copy.splice(idx, 1)[0]);
        }
        return result;
    }

    function isoDate(start, end) {
        const ms = Math.floor(rand() * (end - start)) + start;
        return new Date(ms).toISOString().replace(/\.\d{3}Z$/, '.000Z');
    }

    return { rand, int, float, bool, pick, pickN, isoDate };
}

// ========================== Products generator ================================

const PRODUCT_NAMES = [
    'Wireless Noise-Cancelling Headphones',
    'Portable Bluetooth Speaker',
    'Smart Watch Pro',
    'USB-C Hub 7-in-1',
    'Mechanical Keyboard RGB',
    'Gaming Mouse Precision',
    'LED Desk Lamp',
    'Laptop Stand Adjustable',
    'Webcam 4K Ultra HD',
    'External SSD 1TB',
    'Running Shoes Ultralight',
    'Yoga Mat Non-Slip',
    'Denim Jacket Classic',
    'Merino Wool Sweater',
    'Canvas Backpack 30L',
    'Leather Wallet Slim',
    'Sunglasses Polarised',
    'Winter Coat Insulated',
    'Cotton Crew-Neck T-Shirt',
    'Waterproof Hiking Boots',
    'JavaScript: The Good Parts',
    'Clean Code Handbook',
    'The Pragmatic Programmer',
    'Designing Data-Intensive Apps',
    'Python Crash Course',
    'Deep Learning with Python',
    'The Art of Unix Programming',
    'Site Reliability Engineering',
    'Refactoring: Improving the Design',
    'Domain-Driven Design',
    'Organic Dark Chocolate 85%',
    'Cold Brew Coffee Concentrate',
    'Protein Bar Variety Pack',
    'Matcha Green Tea Powder',
    'Raw Honey 500g',
    'Granola Muesli Mix',
    'Olive Oil Extra Virgin 1L',
    'Sparkling Water 12-pack',
    'Almond Butter Crunchy',
    'Dried Mango Strips',
    'Smart Home Hub',
    'Air Purifier HEPA',
    'Robot Vacuum Cleaner',
    'Instant Pot 6-Quart',
    'Cast Iron Skillet 10"',
    'Bamboo Cutting Board Set',
    'Coffee Grinder Burr',
    'Stand Mixer 5.5Qt',
    'Food Scale Digital',
    'Blender High Performance',
];

const BRANDS = [
    'TechNova', 'AudioTech', 'SwiftGear', 'PureLife', 'ZenWear',
    'BoldCraft', 'ApexPro', 'ClearVision', 'NorthEdge', 'UrbanCore',
    'GreenLeaf', 'SkyForge', 'IronMesh', 'WaveTech', 'SunRidge',
    'FrostLine', 'StormPeak', 'DeepRoot', 'LunaFlow', 'CrispAir',
];

const ALL_TAGS = [
    'sale', 'new', 'bestseller', 'wireless', 'bluetooth', 'eco',
    'premium', 'lightweight', 'waterproof', 'organic', 'vegan',
    'limited', 'bundle', 'gift', 'refurbished', 'imported',
    'handmade', 'certified', 'fast-shipping', 'clearance',
];

const DESCRIPTIONS = [
    'Experience superior quality with this thoughtfully designed product, built for everyday performance and long-lasting durability.',
    'Engineered for professionals and enthusiasts alike, this product combines cutting-edge technology with an ergonomic form factor.',
    'A carefully curated selection that meets the highest standards of quality, delivering exceptional value for the price.',
    'Crafted from premium materials with meticulous attention to detail, this product is designed to exceed your expectations.',
    'Whether at home, in the office, or on the go, this versatile product adapts seamlessly to your lifestyle needs.',
    'Backed by extensive research and user feedback, this product represents the pinnacle of its category with proven results.',
    'Sustainable, responsible, and high-performing — this product is designed with both you and the planet in mind.',
    'Originally developed for professional use, now available for consumers who demand nothing less than the best.',
    'Combines classic aesthetics with modern functionality, making it the ideal choice for discerning customers.',
    'With its compact design and powerful performance, this product punches well above its weight class.',
];

const SPEC_KEYS_ELECTRONICS = ['connectivity', 'batteryLife', 'weight', 'warranty', 'dimensions', 'powerInput'];
const SPEC_KEYS_CLOTHING = ['material', 'fit', 'careInstructions', 'origin', 'season'];
const SPEC_KEYS_BOOKS = ['pages', 'publisher', 'language', 'edition', 'isbn'];
const SPEC_KEYS_FOOD = ['weight', 'servings', 'calories', 'allergens', 'origin', 'certification'];

const SPEC_VALUES = {
    connectivity: ['Bluetooth 5.0', 'Wi-Fi 6', 'USB-C', 'NFC', 'Wired'],
    batteryLife: ['12 hours', '24 hours', '30 hours', '48 hours', '72 hours'],
    weight: ['150g', '250g', '500g', '1kg', '2kg'],
    warranty: ['1 year', '2 years', '3 years', '90 days', 'Lifetime'],
    dimensions: ['10x5x3 cm', '20x15x8 cm', '30x20x10 cm', '5x5x5 cm'],
    powerInput: ['5V/2A', '9V/3A', '12V/2A', '20V/5A'],
    material: ['100% Cotton', 'Polyester blend', 'Merino Wool', 'Linen', 'Nylon'],
    fit: ['Regular', 'Slim', 'Relaxed', 'Oversized'],
    careInstructions: ['Machine wash cold', 'Hand wash only', 'Dry clean only'],
    origin: ['Made in USA', 'Made in Germany', 'Made in Japan', 'Made in Italy'],
    season: ['All season', 'Summer', 'Winter', 'Spring/Fall'],
    pages: ['256', '320', '420', '512', '640', '768'],
    publisher: ["O'Reilly", 'Packt', 'Manning', 'Apress', 'Addison-Wesley'],
    language: ['English'],
    edition: ['1st edition', '2nd edition', '3rd edition', '4th edition'],
    isbn: ['978-0-596-51774-8', '978-0-13-468599-1', '978-1-491-95042-1'],
    servings: ['4', '8', '12', '16', '24'],
    calories: ['120 kcal', '180 kcal', '220 kcal', '350 kcal'],
    allergens: ['None', 'Contains nuts', 'Contains gluten', 'Contains dairy'],
    certification: ['USDA Organic', 'Fair Trade', 'Non-GMO', 'Gluten-Free'],
};

function buildSpecifications(h, category) {
    const keys =
        category === 'Electronics' ? SPEC_KEYS_ELECTRONICS
        : category === 'Clothing' ? SPEC_KEYS_CLOTHING
        : category === 'Books' ? SPEC_KEYS_BOOKS
        : SPEC_KEYS_FOOD;

    const count = h.int(2, 4);
    const chosen = h.pickN(keys, count);
    const specs = {};
    for (const k of chosen) {
        const vals = SPEC_VALUES[k];
        specs[k] = vals ? h.pick(vals) : `value-${h.int(1, 100)}`;
    }
    return specs;
}

function generateProducts() {
    const h = makeHelpers(42);
    const START = new Date('2023-01-01').getTime();
    const END = new Date('2025-12-31').getTime();

    const CATEGORIES = ['Electronics', 'Electronics', 'Electronics', 'Clothing', 'Clothing', 'Books', 'Books', 'Food', 'Food', 'Food'];

    const SHARED_NAME = 'Wireless Noise-Cancelling Headphones'; // for indices 3 & 4

    const docs = [];

    for (let i = 0; i < 10000; i++) {
        const category = h.pick(CATEGORIES);
        const namePool = PRODUCT_NAMES.filter((n) => {
            if (category === 'Electronics') return n.match(/Headphone|Speaker|Watch|Hub|Keyboard|Mouse|Lamp|Stand|Webcam|SSD|Home|Air|Robot|Coffee Grinder|Scale|Blender/);
            if (category === 'Clothing') return n.match(/Shoes|Yoga|Jacket|Sweater|Backpack|Wallet|Sunglasses|Coat|T-Shirt|Boots/);
            if (category === 'Books') return n.match(/JavaScript|Clean Code|Pragmatic|Data|Python|Deep|Unix|Reliability|Refactoring|Domain/);
            return n.match(/Chocolate|Coffee|Protein|Matcha|Honey|Granola|Olive|Water|Almond|Mango|Instant|Cast|Cutting|Stand Mixer/);
        });
        const nameSrc = namePool.length > 0 ? namePool : PRODUCT_NAMES;

        const doc = {
            id: `prod-${String(i).padStart(5, '0')}`,
            name: h.pick(nameSrc),
            category,
            brand: BRANDS[h.int(0, BRANDS.length - 1)],
            price: h.float(0.99, 499.99, 2),
            rating: h.float(1.0, 5.0, 1),
            inStock: h.bool(0.7),
            tags: h.pickN(ALL_TAGS, h.int(1, 5)),
            description: h.pick(DESCRIPTIONS),
            specifications: buildSpecifications(h, category),
            createdAt: h.isoDate(START, END),
            _partitionKey: category,
        };

        // ── Mandatory tricky documents ──────────────────────
        if (i === 0) {
            doc.description = null;
        }
        if (i === 1) {
            delete doc.brand; // IS_DEFINED test
        }
        if (i === 2) {
            doc.price = 0;
        }
        if (i === 3 || i === 4) {
            doc.name = SHARED_NAME; // DISTINCT test
            doc.category = 'Electronics';
            doc._partitionKey = 'Electronics';
        }
        if (i === 5) {
            doc.rating = null;
            doc.tags = [];
        }
        // Every 15th (except index 0): null rating
        if (i > 5 && i % 15 === 0) {
            doc.rating = null;
        }
        // Every 25th (except index 0): null description
        if (i > 5 && i % 25 === 0) {
            doc.description = null;
        }
        // Every 50th (except index 1): omit brand
        if (i > 5 && i % 50 === 0) {
            delete doc.brand;
        }
        // Every 30th (except index 5): empty tags
        if (i > 5 && i % 30 === 0) {
            doc.tags = [];
        }

        docs.push(doc);
    }

    return docs;
}

// ========================== Orders generator ==================================

const CITIES = [
    { city: 'New York', state: 'NY', country: 'US', zip: '10001' },
    { city: 'Los Angeles', state: 'CA', country: 'US', zip: '90001' },
    { city: 'Chicago', state: 'IL', country: 'US', zip: '60601' },
    { city: 'Houston', state: 'TX', country: 'US', zip: '77001' },
    { city: 'Toronto', state: 'ON', country: 'CA', zip: 'M5H 2N2' },
    { city: 'Vancouver', state: 'BC', country: 'CA', zip: 'V6B 1A1' },
    { city: 'London', state: 'ENG', country: 'UK', zip: 'EC1A 1BB' },
    { city: 'Manchester', state: 'ENG', country: 'UK', zip: 'M1 1AE' },
    { city: 'Berlin', state: 'BE', country: 'DE', zip: '10115' },
    { city: 'Munich', state: 'BY', country: 'DE', zip: '80331' },
];

const CARRIERS = ['FedEx', 'UPS', 'DHL'];
const STATUSES = ['pending', 'pending', 'processing', 'shipped', 'shipped', 'shipped', 'delivered', 'delivered', 'delivered', 'cancelled'];

const ORDER_ITEM_NAMES = [
    'Wireless Headphones', 'Laptop Stand', 'USB Hub', 'Mechanical Keyboard',
    'Gaming Mouse', 'LED Strip Lights', 'Smart Plug', 'Power Bank 20000mAh',
    'Screen Protector', 'Phone Case Premium', 'Desk Organizer', 'Cable Management Kit',
    'Ergonomic Chair Cushion', 'Monitor Arm Single', 'Webcam Cover Slider',
    'Microfibre Cleaning Cloth', 'Laptop Bag 15"', 'Wrist Rest Gel',
    'Desk Mat XL', 'Blue Light Glasses',
];

function generateOrders() {
    const h = makeHelpers(43); // different seed for independence
    const START = new Date('2023-01-01').getTime();
    const END = new Date('2025-12-31').getTime();

    const SHARED_DATE = '2024-06-15T10:00:00.000Z'; // for indices 2 & 3

    const docs = [];

    for (let i = 0; i < 8000; i++) {
        const customerId = `cust-${String((i % 500) + 1).padStart(3, '0')}`;
        const status = h.pick(STATUSES);
        const isShippable = status === 'shipped' || status === 'delivered';

        const itemCount = h.int(1, 5);
        const items = [];
        let totalAmount = 0;

        for (let j = 0; j < itemCount; j++) {
            const qty = h.int(1, 4);
            const unitPrice = h.float(5.99, 299.99, 2);
            totalAmount += qty * unitPrice;
            items.push({
                productId: `prod-${String(h.int(0, 2999)).padStart(4, '0')}`,
                name: h.pick(ORDER_ITEM_NAMES),
                quantity: qty,
                unitPrice,
            });
        }
        totalAmount = parseFloat(totalAmount.toFixed(2));

        const address = h.pick(CITIES);
        const carrier = isShippable ? h.pick(CARRIERS) : null;
        const trackingNumber = carrier ? `${carrier.toUpperCase().slice(0, 3)}${h.int(100000000, 999999999)}` : null;
        const discountRoll = h.rand();
        const discount = discountRoll < 0.3 ? h.pick([5, 10, 15, 20]) : null;

        const doc = {
            id: `order-${String(i).padStart(4, '0')}`,
            customerId,
            status,
            totalAmount,
            createdAt: h.isoDate(START, END),
            items,
            shipping: {
                address: { ...address },
                carrier,
                trackingNumber,
            },
            discount,
            _partitionKey: customerId,
        };

        // ── Mandatory tricky documents ──────────────────────
        if (i === 0) {
            doc.items = [];
            doc.totalAmount = 0;
        }
        if (i === 1) {
            doc.shipping.carrier = null;
            doc.shipping.trackingNumber = null;
        }
        if (i === 2 || i === 3) {
            doc.customerId = 'cust-001';
            doc._partitionKey = 'cust-001';
            doc.createdAt = SHARED_DATE; // same day, same customer
        }
        if (i === 4) {
            doc.discount = 0; // explicitly zero, not null
        }
        if (i === 5) {
            // 10-item order
            doc.items = Array.from({ length: 10 }, (_, j) => {
                const qty = h.int(1, 3);
                const unitPrice = h.float(9.99, 99.99, 2);
                return {
                    productId: `prod-${String(h.int(0, 2999)).padStart(4, '0')}`,
                    name: h.pick(ORDER_ITEM_NAMES),
                    quantity: qty,
                    unitPrice,
                };
            });
            doc.totalAmount = parseFloat(
                doc.items.reduce((s, x) => s + x.quantity * x.unitPrice, 0).toFixed(2),
            );
        }

        docs.push(doc);
    }

    return docs;
}

// ========================== Events generator ==================================

const EVENT_PAGES = ['/home', '/products', '/cart', '/checkout', '/account', '/blog', '/about', '/search', '/deals', '/wishlist'];
const SESSION_CHARS = 'abcdef0123456789';

function makeSessionId(h) {
    const seg = (n) => Array.from({ length: n }, () => SESSION_CHARS[h.int(0, 15)]).join('');
    return `${seg(8)}-${seg(4)}-${seg(4)}-${seg(4)}-${seg(12)}`;
}

function generateEvents() {
    const h = makeHelpers(44); // independent seed

    const WIN_START = new Date('2025-01-01').getTime();
    const WIN_END = new Date('2025-01-07T23:59:59').getTime();

    const SHARED_USER = 'u-1';
    const SHARED_TS = '2025-01-03T14:30:00.000Z';

    const TYPE_POOL = [
        'click', 'click', 'click', 'click',
        'view', 'view', 'view',
        'purchase', 'purchase',
        'signup',
        'error',
    ];

    const ERROR_CODES = ['ERR_500', 'ERR_404', 'ERR_AUTH', 'ERR_TIMEOUT', 'ERR_LIMIT'];

    const docs = [];

    for (let i = 0; i < 15000; i++) {
        const type = h.pick(TYPE_POOL);
        const userId = `u-${h.int(1, 10)}`;
        const sessionId = makeSessionId(h);

        const properties = {};
        if (type === 'click' || type === 'view') {
            properties.page = h.pick(EVENT_PAGES);
            if (h.bool(0.4)) properties.referrer = `https://ref${h.int(1, 5)}.example.com`;
        }
        if (type === 'view' || type === 'purchase') {
            properties.productId = `prod-${String(h.int(0, 2999)).padStart(4, '0')}`;
        }
        if (type === 'purchase') {
            properties.amount = h.float(5.99, 499.99, 2);
        }
        if (type === 'error') {
            properties.errorCode = h.pick(ERROR_CODES);
            properties.errorMessage = `Error occurred: ${properties.errorCode}`;
        }

        const instantEvent = type === 'signup' || type === 'error';
        const durationMs = instantEvent ? null : h.int(100, 30000);

        const doc = {
            id: `evt-${String(i).padStart(5, '0')}`,
            type,
            userId,
            sessionId,
            timestamp: h.isoDate(WIN_START, WIN_END),
            durationMs,
            properties,
            _partitionKey: userId,
        };

        // ── Mandatory tricky documents ──────────────────────
        if (i === 0 || i === 1) {
            doc.userId = SHARED_USER;
            doc._partitionKey = SHARED_USER;
            doc.timestamp = SHARED_TS; // identical (userId, timestamp)
        }
        if (i === 2) {
            delete doc.durationMs; // field entirely absent — IS_DEFINED test
        }
        if (i === 3) {
            doc.durationMs = 0; // explicit zero — edge for > 0 filter
        }

        docs.push(doc);
    }

    return docs;
}

// ========================== CLI ==============================================

const args = process.argv.slice(2);
const containerArg = args[args.indexOf('--container') + 1];
const runAll = args.includes('--all');

const generators = {
    products: generateProducts,
    orders: generateOrders,
    events: generateEvents,
};

function run(name) {
    console.log(`\nGenerating ${name}…`);
    const docs = generators[name]();
    const json = JSON.stringify(docs, null, 2);
    const outPath = resolve(FIXTURES_DIR, `${name}.seed.json`);
    writeFileSync(outPath, json, 'utf-8');
    const mb = (Buffer.byteLength(json) / 1024 / 1024).toFixed(2);
    console.log(`  ✓ ${docs.length} documents → ${outPath} (${mb} MB)`);
}

if (runAll) {
    for (const name of Object.keys(generators)) run(name);
} else if (containerArg && generators[containerArg]) {
    run(containerArg);
} else {
    console.error('Usage: node scripts/generate-nosql-seed.mjs --container products|orders|events');
    console.error('       node scripts/generate-nosql-seed.mjs --all');
    process.exit(1);
}

