/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { API } from '../../../../../AzureDBExperiences';
import { countUserExcludedPaths } from '../../inventory';
import { type StoragePartitionSeries } from '../core/types';
import { GIB } from '../detectors/storageMath';
import { number, shapedValues, throughputMode, type Binding, type World } from './shared';

const scope = { databaseId: 'fixture-db', containerId: 'fixture-container' };
const day = 86_400_000;

function context(pattern: RegExp, execute: Binding['execute']): Binding {
    return { type: 'Context', pattern, execute };
}

function partition(current: number, rate = 0, id = '0'): StoragePartitionSeries {
    return {
        partitionId: id,
        samples: Array.from({ length: 10 }, (_, index) => ({
            timestamp: Date.UTC(2026, 0, 1) + index * day,
            bytes: (current - (9 - index) * rate) * GIB,
        })),
    };
}

function queries(world: World, total: number, fanout: number, partitions: number, hours: number, average = partitions) {
    world.queries = {
        ...scope,
        evaluationWindowSeconds: hours * 3600,
        shapes: [
            { text: 'SELECT * FROM c', executions: fanout, avgFanout: average, maxFanout: partitions },
            { text: 'SELECT * FROM c WHERE c.id = @id', executions: total - fanout, avgFanout: 1, maxFanout: 1 },
        ].filter((shape) => shape.executions > 0),
    };
}

function indexing(world: World, index: (number | undefined)[], data: (number | undefined)[]) {
    world.indexing = { ...scope, indexingMode: 'consistent', userExcludedPathCount: 0 };
    world.indexSeries = index;
    world.dataSeries = data;
}

export const additionalFixtures: readonly Binding[] = [
    context(
        /^a container with (\d+) queries that all fan out across (\d+) physical partitions in a (\S+) hour window$/,
        (world, match) => {
            queries(world, number(match[1]), number(match[1]), number(match[2]), number(match[3]));
        },
    ),
    context(
        /^a container with (\d+) queries of which (\d+) fan out across (\d+) physical partitions in a (\S+) hour window$/,
        (world, match) => {
            queries(world, number(match[1]), number(match[2]), number(match[3]), number(match[4]));
        },
    ),
    context(
        /^a container with (\d+) queries averaging (\S+) partitions out of (\d+) physical partitions in a (\S+) hour window$/,
        (world, match) => {
            queries(world, number(match[1]), number(match[1]), number(match[3]), number(match[4]), number(match[2]));
        },
    ),
    context(/^a container with no query telemetry$/, (world) => {
        world.queries = { ...scope, shapes: [], evaluationWindowSeconds: 24 * 3600 };
    }),
    context(/^every query costs (\S+) RU$/, (_world, match) => {
        // The native fan-out input deliberately has no RU gate; this fixture dimension is not a verdict.
        assert.ok(number(match[1]) >= 0);
    }),
    context(/^(?:a Log Analytics workspace that fails the query|the Log Analytics query fails)$/, (world) => {
        world.logFailure = true;
    }),
    context(/^the Log Analytics query returns no rows$/, (world) => {
        world.emptyLogs = true;
    }),
    context(/^a shared database with (\S+) RU\/s$/, (world, match) => {
        world.shared = {
            databaseId: scope.databaseId,
            sharedRu: number(match[1]),
            collections: [],
            sharedContainerIds: [],
        };
    }),
    context(/^collection "([^"]+)" has (\d+) requests, (\d+) throttled and (\S+) RU consumed$/, (world, match) => {
        assert.ok(world.shared);
        world.shared.collections = [
            ...world.shared.collections,
            {
                containerId: match[1],
                requests: number(match[2]),
                throttledRequests: number(match[3]),
                ruConsumed: number(match[4]),
            },
        ];
        world.shared.sharedContainerIds = [...(world.shared.sharedContainerIds ?? []), match[1]];
    }),
    context(
        /^a (manual|autoscale) container with (\S+) RU\/s that consumed at most (\S+) RU in any bucket$/,
        (world, match) => {
            world.idle = {
                ...scope,
                throughputMode: throughputMode(match[1]),
                provisionedRu: number(match[2]),
                peakRuPerBucket: number(match[3]),
            };
        },
    ),
    context(/^a manual container with (\S+) RU\/s and no consumption telemetry$/, (world, match) => {
        world.idle = { ...scope, throughputMode: 'dedicated', provisionedRu: number(match[1]) };
    }),
    context(
        /^a shared-throughput database offer of (\S+) RU\/s that consumed at most (\S+) RU in any bucket$/,
        (world, match) => {
            world.idle = {
                databaseId: scope.databaseId,
                throughputMode: 'shared',
                provisionedRu: number(match[1]),
                peakRuPerBucket: number(match[2]),
            };
        },
    ),
    context(/^a (manual|autoscale) offer at (container|database) level$/, (world, match) => {
        world.applicabilityMode = throughputMode(match[1], match[2]);
    }),
    context(/^the serverless detection set$/, (world) => {
        world.applicabilityMode = 'serverless';
    }),
    context(
        /^(?:a|an) (?:(manual|autoscale|serverless) )?container with (\d+) requests of which (\d+) were throttled$/,
        (world, match) => {
            world.requests = {
                total: number(match[2]),
                throttled: number(match[3]),
                mode: match[1] ? throughputMode(match[1]) : 'dedicated',
            };
        },
    ),
    context(/^its partitions peak at (.+) percent utilization$/, (world, match) => {
        world.partitionPeaks = match[1].split(/\s+and\s+|,/).map(number);
    }),
    context(/^it reports no partition utilization$/, (world) => {
        world.partitionPeaks = [];
    }),
    context(/^the container was created (\S+) hours before the window ended$/, (world, match) => {
        world.age = number(match[1]) / 24;
    }),
    context(/^writes consumed (\S+) of (\S+) RU$/, (world, match) => {
        world.writeRu = number(match[1]);
        world.totalRu = number(match[2]);
    }),
    context(
        /^a manual container with (\d+) samples averaging (\S+) percent and peaking at (\S+) percent$/,
        (world, match) => {
            world.manual = {
                ...scope,
                provisionedRu: 10_000,
                ruPercents: shapedValues(number(match[1]), number(match[2]), number(match[3])),
            };
        },
    ),
    context(/^a manual container with no utilization data$/, (world) => {
        world.manual = { ...scope, provisionedRu: 10_000, ruPercents: [] };
    }),
    context(
        /^an autoscale container with a (\d+) RU\/s max and (\d+) samples averaging (\S+) percent and peaking at (\S+) percent$/,
        (world, match) => {
            const max = number(match[1]);
            const series = shapedValues(number(match[2]), number(match[3]), number(match[4])).map(
                (percent) => (percent * max) / 100,
            );
            world.autoscale = { max, samples: series.length, peaks: [], series: [series], shared: false };
        },
    ),
    context(
        /^an autoscale container with a (\d+) RU\/s max whose two partitions each provision (\d+) RU\/s for (\d+) samples$/,
        (world, match) => {
            const samples = number(match[3]);
            world.autoscale = {
                max: number(match[1]),
                samples,
                peaks: [],
                shared: false,
                series: [Array<number>(samples).fill(number(match[2])), Array<number>(samples).fill(number(match[2]))],
            };
        },
    ),
    context(/^an account with (\d+) hourly samples at (\S+) RU\/s and one peak of (\S+) RU\/s$/, (world, match) => {
        world.hourlyRu = Array.from({ length: number(match[1]) }, (_, index) =>
            index === number(match[1]) - 1 ? number(match[3]) : number(match[2]),
        );
    }),
    context(/^an account with no consumed RU data$/, (world) => {
        world.hourlyRu = [];
    }),
    context(
        /^(?:the container's request metrics show|a single recent metric sample shows) (\d+) requests and (\d+) throttled responses$/,
        (world, match) => {
            world.requests = { total: number(match[1]), throttled: number(match[2]), mode: 'serverless' };
        },
    ),
    context(/^(\d+) requests of which (\d+) were throttled$/, (world, match) => {
        world.statuses = { 200: number(match[1]) - number(match[2]), 429: number(match[2]) };
    }),
    context(/^(\d+) throttled (\S+) operations$/, (world, match) => {
        world.operations = { ...world.operations, [match[2]]: number(match[1]) };
    }),
    context(/^a (non-production|production) account$/, (world, match) => {
        world.account.tags = { environment: match[1] === 'production' ? 'prod' : 'dev' };
    }),
    context(/^an account with no environment signal$/, (world) => {
        world.account.tags = undefined;
    }),
    context(/^multi-region writes are disabled$/, (world) => {
        world.account.multiRegionWritesEnabled = false;
    }),
    context(
        /^an account using the (sql|mongo|cassandra|gremlin|table) API with multi-region writes across (\d+) write regions$/,
        (world, match) => {
            const apis = {
                sql: API.Core,
                mongo: 'MongoDB',
                cassandra: API.Cassandra,
                gremlin: API.Graph,
                table: API.Table,
            } as const;
            const api = Object.entries(apis).find(([name]) => name === match[1])?.[1];
            assert.ok(api);
            Object.assign(world.account, {
                api,
                multiRegionWritesEnabled: true,
                writeRegionCount: number(match[2]),
                regionCount: Math.max(number(match[2]), 1),
            });
        },
    ),
    context(/^manual throughput offers of (\S+) and (\S+) RU\/s$/, (world, match) => {
        world.inputs.manualRegionalCapacityRu = number(match[1]) + number(match[2]);
    }),
    context(/^(?:an autoscale offer of (\S+) RU\/s|no throughput offers)$/, (world, match) => {
        if (match[1]) {
            number(match[1]);
        }
        world.inputs.manualRegionalCapacityRu = undefined;
    }),
    context(/^a serverless account$/, (world) => {
        world.account.isServerless = true;
        world.inputs.manualRegionalCapacityRu = 1000;
    }),
    context(/^the account is (?:already )?serverless$/, (world) => {
        world.account.isServerless = true;
    }),
    context(/^the account spans (\d+) regions$/, (world, match) => {
        world.account.regionCount = number(match[1]);
    }),
    context(/^per-region provisioned autoscale is enabled$/, (world) => {
        world.account.perRegionPerPartitionAutoscaleEnabled = true;
    }),
    context(/^an account provisioning (\S+) RU\/s$/, (world, match) => {
        world.inputs.scopeProvisionedRuTotal = number(match[1]);
    }),
    context(/^an account with unknown provisioned throughput$/, (world) => {
        world.inputs.scopeProvisionedRuTotal = undefined;
    }),
    context(/^the default consistency is (.+)$/, (world, match) => {
        world.account.consistencyLevel = match[1];
    }),
    context(/^the account does not report a consistency level$/, (world) => {
        world.account.consistencyLevel = undefined;
    }),
    context(
        /^the (?:account )?backup policy is (Continuous|Periodic|unknown)(?: with tier (\S+))?$/,
        (world, match) => {
            world.account.backupPolicy = {
                type: match[1] === 'unknown' ? undefined : match[1],
                continuousTier: match[2] === 'none' ? undefined : match[2],
            };
        },
    ),
    context(/^the account reports no backup policy$/, (world) => {
        world.account.backupPolicy = undefined;
    }),
    context(/^a backup-policy migration to Continuous is in progress$/, (world) => {
        world.account.backupPolicy = {
            ...world.account.backupPolicy,
            type: 'Periodic',
            migrationState: { status: 'InProgress', targetType: 'Continuous' },
        };
    }),
    context(/^all versions and deletes change feed is enabled on the account$/, (world) => {
        world.account.backupPolicy = { ...world.account.backupPolicy, fullFidelityChangeFeedEnabled: true };
    }),
    context(
        /^a container with (\S+) RU\/s provisioned and (\S+) GiB of data on (\d+) physical partitions$/,
        (world, match) => {
            world.merge = {
                ...scope,
                provisionedRu: number(match[1]),
                dataUsageBytes: number(match[2]) * GIB,
                actualPartitions: number(match[3]),
            };
        },
    ),
    context(/^a container with no partition count data$/, (world) => {
        world.merge = { ...scope, actualPartitions: 0 };
    }),
    context(/^a container whose partitions hold (.+) GiB$/, (world, match) => {
        world.storage = {
            ...scope,
            partitions: match[1].split(',').map((size, index) => partition(number(size), 0, `${index}`)),
        };
    }),
    context(/^a container (?:reporting no partition storage|with no partition size data)$/, (world) => {
        world.storage = { ...scope, partitions: [] };
    }),
    context(/^the busiest partition holds (\S+) GiB and grows (\S+) GiB per day$/, (world, match) => {
        world.storage = { ...scope, partitions: [partition(number(match[1]), number(match[2]))] };
    }),
    context(
        /^a container with a partition at 50 GiB and another partition (growing quickly|flat at 10 GiB)$/,
        (world, match) => {
            world.storage = {
                ...scope,
                partitions: [
                    partition(50),
                    partition(match[1] === 'growing quickly' ? 20 : 10, match[1] === 'growing quickly' ? 2 : 0, '1'),
                ],
            };
        },
    ),
    context(
        /^a container with a partition at 40 GiB growing 1 GiB per day and another partition at 20 GiB growing 1 GiB per day$/,
        (world) => {
            world.storage = { ...scope, partitions: [partition(40, 1), partition(20, 1, '1')] };
        },
    ),
    context(/^the (?:full|faster) partition is listed (first|last)$/, (world, match) => {
        assert.ok(world.storage);
        if (match[1] === 'last') {
            world.storage.partitions = [...world.storage.partitions].reverse();
        }
    }),
    context(/^a container with (\S+) GiB of index and (\S+) GiB of data$/, (world, match) => {
        indexing(world, [number(match[1]) * GIB], [number(match[2]) * GIB]);
    }),
    context(/^a container with no index or data samples$/, (world) => {
        indexing(world, [undefined], [undefined]);
    }),
    context(/^a container whose newest storage sample is still unpopulated$/, (world) => {
        indexing(world, [10 * GIB, 60 * GIB, undefined], [100 * GIB, 100 * GIB, undefined]);
    }),
    context(/^the indexing policy excludes only the default etag path$/, (world) => {
        assert.ok(world.indexing);
        world.indexing.userExcludedPathCount = countUserExcludedPaths([{ path: '/_etag/?' }]);
    }),
    context(/^the indexing policy excludes (\d+) user paths$/, (world, match) => {
        assert.ok(world.indexing);
        world.indexing.userExcludedPathCount = countUserExcludedPaths([
            { path: '/_etag/?' },
            ...Array.from({ length: number(match[1]) }, (_, index) => ({ path: `/p${index}/*` })),
        ]);
    }),
    context(/^the indexing mode is (\S+)$/, (world, match) => {
        assert.ok(world.indexing);
        world.indexing.indexingMode = match[1];
    }),
];
