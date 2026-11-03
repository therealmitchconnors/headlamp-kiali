import {
  readConfig,
  updateClusterConfig,
  validateTelemetryCluster,
  validateTelemetryStore,
} from './config';

it('accepts explicit bounded identities without confusing them with DNS names or guessing contexts', () => {
  for (const value of ['Kubernetes', 'east-west', 'mesh/region', 'quoted"cluster', 'x'.repeat(256)])
    expect(validateTelemetryCluster(value)).toBe(value);
  expect(readConfig(undefined)).toEqual({
    valid: true,
    config: { schemaVersion: 1, clusters: {} },
  });
});
it.each(['', ' ', ' east', 'east ', 'east\n', 'east\u0000west', 'x'.repeat(257), null, 1])(
  'rejects invalid saved telemetry identity %j',
  value => {
    expect(() => validateTelemetryCluster(value)).toThrow('Metric cluster label');
  }
);
it('validates explicit store identities independently of metric and mesh identities', () => {
  expect(validateTelemetryStore('shared-prometheus')).toBe('shared-prometheus');
  for (const value of ['', ' store', 'store ', 'store\n', null, 1])
    expect(() => validateTelemetryStore(value)).toThrow('Telemetry store identity');
});
it('round-trips optional identity and null clearing while preserving unrelated settings', () => {
  const original = {
    schemaVersion: 1 as const,
    clusters: {
      alpha: {
        prometheus: null,
        identityDomain: 'svc.example',
        tracing: null,
        telemetryStore: 'shared',
      },
      beta: { prometheus: null, telemetryCluster: 'beta-id' },
    },
  };
  const updated = updateClusterConfig(original, 'alpha', {
    prometheus: null,
    telemetryCluster: 'Kubernetes',
    telemetryStore: 'shared-store',
  });
  expect(updated.clusters.alpha).toEqual({
    ...original.clusters.alpha,
    telemetryCluster: 'Kubernetes',
    telemetryStore: 'shared-store',
  });
  expect(updated.clusters.beta).toEqual(original.clusters.beta);
  expect(readConfig(updated)).toEqual({ valid: true, config: updated });
  expect(
    updateClusterConfig(updated, 'alpha', { prometheus: null }).clusters.alpha.telemetryCluster
  ).toBe('Kubernetes');
  expect(
    updateClusterConfig(updated, 'alpha', { prometheus: null, telemetryCluster: null }).clusters
      .alpha.telemetryCluster
  ).toBeNull();
  expect(
    updateClusterConfig(updated, 'alpha', { prometheus: null, telemetryStore: null }).clusters.alpha
      .telemetryStore
  ).toBeNull();
  expect(
    readConfig({
      schemaVersion: 1,
      clusters: { alpha: { prometheus: null, telemetryCluster: ' bad' } },
    }).valid
  ).toBe(false);
});
