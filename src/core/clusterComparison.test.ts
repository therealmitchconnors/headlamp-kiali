import {
  captureClusterComparison,
  duplicateTelemetryIdentities,
  planClusterComparison,
} from './clusterComparison';

const endpoint = { namespace: 'monitoring', service: 'prometheus', port: '9090', basePath: '' };
const config = {
  schemaVersion: 1 as const,
  clusters: {
    east: { prometheus: endpoint, telemetryCluster: 'mesh-east' },
    west: { prometheus: endpoint, telemetryCluster: 'mesh-west' },
    missing: { prometheus: null },
  },
};
it('captures independent Headlamp/telemetry identities and endpoints without mutating settings', () => {
  const plan = planClusterComparison(
    ['east', 'west', 'missing'],
    ['east', 'west', 'missing'],
    config,
    'bookinfo',
    1700000000
  );
  expect(plan.targets).toEqual([
    { cluster: 'east', endpoint, telemetryCluster: 'mesh-east' },
    { cluster: 'west', endpoint, telemetryCluster: 'mesh-west' },
    { cluster: 'missing', endpoint: null, telemetryCluster: null },
  ]);
  expect(plan.targets[0].endpoint).not.toBe(endpoint);
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
      planClusterComparison(clusters, ['east', 'west'], config, 'bookinfo', 1700000000)
    ).toThrow();
  const names = Array.from({ length: 8 }, (_, index) => `cluster-${index}`);
  const query = planClusterComparison(
    names,
    names,
    { schemaVersion: 1, clusters: {} },
    'bookinfo',
    1700000000
  );
  expect(query.targets).toHaveLength(8);
  expect(() =>
    captureClusterComparison({
      ...query,
      targets: [...query.targets, { cluster: 'extra', endpoint: null, telemetryCluster: null }],
    })
  ).toThrow('1 to 8');
  for (const changes of [{ namespace: '../wrong' }, { end: 0 }, { end: NaN }, { end: 0.1 }])
    expect(() => captureClusterComparison({ ...query, ...changes })).toThrow();
});
