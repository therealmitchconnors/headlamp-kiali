import { readConfig, updateClusterConfig, validateTelemetryCluster } from './config';

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
it('round-trips optional identity and null clearing while preserving unrelated settings', () => {
  const original = {
    schemaVersion: 1 as const,
    clusters: {
      alpha: { prometheus: null, identityDomain: 'svc.example', tracing: null },
      beta: { prometheus: null, telemetryCluster: 'beta-id' },
    },
  };
  const updated = updateClusterConfig(original, 'alpha', {
    prometheus: null,
    telemetryCluster: 'Kubernetes',
  });
  expect(updated.clusters.alpha).toEqual({
    ...original.clusters.alpha,
    telemetryCluster: 'Kubernetes',
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
    readConfig({
      schemaVersion: 1,
      clusters: { alpha: { prometheus: null, telemetryCluster: ' bad' } },
    }).valid
  ).toBe(false);
});
