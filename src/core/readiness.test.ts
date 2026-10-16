import { replicaReadiness } from './readiness';

describe('Kubernetes replica readiness, not inferred mesh health', () => {
  it.each(['Deployment', 'StatefulSet', 'ReplicaSet', 'ReplicationController'])(
    'reads %s replicas',
    kind => {
      expect(
        replicaReadiness({ kind, spec: { replicas: 3 }, status: { readyReplicas: 2 } })
      ).toEqual({ ready: 2, desired: 3 });
      expect(replicaReadiness({ kind, spec: {}, status: {} })).toEqual({ ready: 0, desired: 1 });
      expect(replicaReadiness({ kind, spec: { replicas: 0 }, status: {} })).toEqual({
        ready: 0,
        desired: 0,
      });
    }
  );

  it('uses scheduling counts for DaemonSets', () => {
    expect(
      replicaReadiness({
        kind: 'DaemonSet',
        spec: {},
        status: { desiredNumberScheduled: 7, numberReady: 6 },
      })
    ).toEqual({ desired: 7, ready: 6 });
  });

  it.each([
    null,
    {},
    { kind: 'Deployment', spec: {} },
    { kind: 'Job', spec: {}, status: { succeeded: 1 } },
    { kind: 'DaemonSet', spec: {}, status: {} },
    { kind: 'Deployment', spec: { replicas: -1 }, status: {} },
    { kind: 'Deployment', spec: {}, status: { readyReplicas: '1' } },
  ])('preserves unknown or invalid data as unknown %j', input => {
    expect(replicaReadiness(input)).toBeNull();
  });
});
