import {
  captureClusterComparison,
  duplicateTelemetryIdentities,
  normalizeComparisonStores,
  planClusterComparison,
} from './clusterComparison';

const endpoint = { namespace: 'monitoring', service: 'prometheus', port: '9090', basePath: '' };
const end = 1700000000;
const point = { timestamp: end, requests: 2, errors: 1, errorPercent: 50 };
const config = {
  schemaVersion: 1 as const,
  clusters: {
    east: {
      prometheus: endpoint,
      meshClusterName: 'logical-east',
      telemetryCluster: 'mesh-east',
      telemetryStore: 'shared-store',
    },
    west: {
      prometheus: endpoint,
      meshClusterName: 'logical-west',
      telemetryCluster: 'mesh-west',
      telemetryStore: 'shared-store',
    },
    missing: { prometheus: null },
  },
};
it('captures independent Headlamp/telemetry identities and endpoints without mutating settings', () => {
  const plan = planClusterComparison(
    ['east', 'west', 'missing'],
    ['east', 'west', 'missing'],
    config,
    'bookinfo',
    end - 3600,
    end
  );
  expect(plan.targets).toEqual([
    {
      cluster: 'east',
      endpoint,
      meshClusterName: 'logical-east',
      telemetryCluster: 'mesh-east',
      telemetryStore: 'shared-store',
    },
    {
      cluster: 'west',
      endpoint,
      meshClusterName: 'logical-west',
      telemetryCluster: 'mesh-west',
      telemetryStore: 'shared-store',
    },
    {
      cluster: 'missing',
      endpoint: null,
      meshClusterName: null,
      telemetryCluster: null,
      telemetryStore: null,
    },
  ]);
  expect(plan.targets[0].endpoint).not.toBe(endpoint);
  expect(plan).toMatchObject({ start: end - 3600, end, step: 60 });
  expect(duplicateTelemetryIdentities(plan.targets)).toEqual([]);
  expect(
    duplicateTelemetryIdentities([
      plan.targets[0],
      { ...plan.targets[1], telemetryCluster: 'mesh-east' },
    ])
  ).toEqual(['mesh-east']);
});
it('enforces explicit available unique targets and exact fan-out bounds', () => {
  for (const clusters of [[], ['east', 'east'], ['unknown']])
    expect(() =>
      planClusterComparison(clusters, ['east', 'west'], config, 'bookinfo', end - 3600, end)
    ).toThrow();
  const names = Array.from({ length: 8 }, (_, index) => `cluster-${index}`);
  const query = planClusterComparison(
    names,
    names,
    { schemaVersion: 1, clusters: {} },
    'bookinfo',
    end - 3600,
    end
  );
  expect(query.targets).toHaveLength(8);
  const maximumRange = captureClusterComparison({ ...query, start: end - 4 * 60 * 60 });
  expect((maximumRange.end - maximumRange.start) / maximumRange.step + 1).toBe(241);
  expect(() => normalizeComparisonStores([], 242)).toThrow('between 1 and 241');
  expect(() =>
    captureClusterComparison({
      ...query,
      targets: [
        ...query.targets,
        {
          cluster: 'extra',
          endpoint: null,
          meshClusterName: null,
          telemetryCluster: null,
          telemetryStore: null,
        },
      ],
    })
  ).toThrow('1 to 8');
  for (const changes of [
    { namespace: '../wrong' },
    { end: 0 },
    { end: NaN },
    { start: end },
    { start: end - 3600, end: end + 1 },
    { start: end - 5 * 60, end },
    { start: end - 5 * 60 * 60, end },
  ])
    expect(() => captureClusterComparison({ ...query, ...changes })).toThrow();
});

it('deduplicates exact shared-store identity samples without merging per-context or unrelated identities', () => {
  const targets = planClusterComparison(
    ['east', 'east-copy', 'west', 'isolated'],
    ['east', 'east-copy', 'west', 'isolated'],
    {
      schemaVersion: 1,
      clusters: {
        east: { prometheus: endpoint, telemetryCluster: 'same-name', telemetryStore: 'shared' },
        'east-copy': {
          prometheus: endpoint,
          telemetryCluster: 'same-name',
          telemetryStore: 'shared',
        },
        west: { prometheus: endpoint, telemetryCluster: 'external:west', telemetryStore: 'shared' },
        isolated: { prometheus: endpoint, telemetryCluster: 'same-name' },
      },
    },
    'bookinfo',
    end - 3600,
    end
  ).targets;
  const stores = normalizeComparisonStores(
    targets.map(target => ({
      target,
      metrics: { status: 'ready' as const, value: { points: [point], warnings: [] } },
    }))
  );
  expect(stores).toHaveLength(2);
  expect(stores[0]).toMatchObject({
    identity: 'shared',
    kind: 'shared',
    sourceClusters: ['east', 'east-copy', 'west'],
    sourceMappings: [
      { cluster: 'east', telemetryCluster: 'same-name' },
      { cluster: 'east-copy', telemetryCluster: 'same-name' },
      { cluster: 'west', telemetryCluster: 'external:west' },
    ],
    status: 'ready',
    points: [{ requests: 4, errors: 2, errorPercent: 50 }],
    duplicates: [{ cluster: 'east-copy', duplicateOf: 'east' }],
  });
  expect(stores[1]).toMatchObject({
    identity: 'isolated',
    kind: 'context',
    status: 'ready',
    points: [{ requests: 2 }],
    duplicates: [],
  });
});

it('keeps endpoint alias ambiguity, missing mappings, empty data and partial failures incomplete', () => {
  const targets = planClusterComparison(
    ['alpha', 'beta', 'missing', 'external'],
    ['alpha', 'beta', 'missing', 'external'],
    {
      schemaVersion: 1,
      clusters: {
        alpha: { prometheus: endpoint, telemetryCluster: 'metric', telemetryStore: 'shared' },
        beta: {
          prometheus: { ...endpoint, service: 'prometheus-alias' },
          telemetryCluster: 'metric',
          telemetryStore: 'shared',
        },
        missing: { prometheus: null, telemetryStore: 'shared' },
        external: {
          prometheus: endpoint,
          telemetryCluster: 'external-label',
          telemetryStore: 'external-store',
        },
      },
    },
    'bookinfo',
    end - 3600,
    end
  ).targets;
  const stores = normalizeComparisonStores([
    { target: targets[0], metrics: { status: 'ready', value: { points: [point], warnings: [] } } },
    { target: targets[1], metrics: { status: 'ready', value: { points: [point], warnings: [] } } },
    {
      target: targets[2],
      metrics: { status: 'not-configured' },
    },
    {
      target: targets[3],
      metrics: { status: 'ready', value: { points: [], warnings: [] } },
    },
  ]);
  expect(stores).toMatchObject([
    { identity: 'shared', status: 'ambiguous', reason: expect.stringContaining('different') },
    { identity: 'external-store', status: 'incomplete', points: [] },
  ]);
  expect(() =>
    captureClusterComparison({
      namespace: 'bookinfo',
      start: end - 3600,
      end,
      step: 60,
      targets: [{ ...targets[0], telemetryStore: '' }],
    })
  ).toThrow('Telemetry store identity');
});

it('does not present warning-bearing provider results as a complete normalized store', () => {
  const targets = planClusterComparison(
    ['alpha', 'beta'],
    ['alpha', 'beta'],
    {
      schemaVersion: 1,
      clusters: {
        alpha: { prometheus: endpoint, telemetryCluster: 'east', telemetryStore: 'shared' },
        beta: { prometheus: endpoint, telemetryCluster: 'west', telemetryStore: 'shared' },
      },
    },
    'bookinfo',
    end - 3600,
    end
  ).targets;
  const [store] = normalizeComparisonStores([
    { target: targets[0], metrics: { status: 'ready', value: { points: [point], warnings: [] } } },
    {
      target: targets[1],
      metrics: { status: 'ready', value: { points: [point], warnings: ['partial data'] } },
    },
  ]);
  expect(store).toMatchObject({ status: 'incomplete', points: [] });
  expect(
    normalizeComparisonStores(
      [{ target: targets[0], metrics: { status: 'ready', value: { points: [point], warnings: [] } } }],
      2
    )[0]
  ).toMatchObject({ status: 'incomplete', points: [] });
  expect(
    normalizeComparisonStores([
      {
        target: targets[0],
        metrics: {
          status: 'ready',
          value: { points: [{ ...point, requests: null }], warnings: [] },
        },
      },
    ])[0]
  ).toMatchObject({ status: 'incomplete', points: [] });
});
