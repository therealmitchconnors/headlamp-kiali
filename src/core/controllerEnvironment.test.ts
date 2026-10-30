import fixtureText from '../../test-files/parity/controller-environment-oracle.json?raw';
import { controlPlaneObservation } from './mesh';

const fixture = JSON.parse(fixtureText) as {
  cases: {
    input: { env: { name: string; value?: string }[] };
    expected: { id: string; shared: string; external: boolean };
  }[];
};
const observe = (env: unknown) =>
  controlPlaneObservation({
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: { name: 'istiod', namespace: 'istio-system', uid: 'cp', labels: { app: 'istiod' } },
    spec: { replicas: 1, template: { spec: { containers: [{ name: 'first', env }] } } },
    status: { replicas: 1, availableReplicas: 1 },
  });
it.each(fixture.cases)(
  'matches original ordered literal environment assignments %#',
  ({ input, expected }) => {
    const result = observe(input.env);
    expect({
      id: result.clusterId ?? '',
      shared: result.sharedMeshConfig ?? '',
      external: result.managesExternal,
    }).toEqual({ id: expected.id, shared: expected.shared, external: expected.external });
  }
);
it.each(['CLUSTER_ID', 'SHARED_MESH_CONFIG'])(
  'does not fall back through a final indirect %s assignment',
  name => {
    const indirect = { name, valueFrom: { configMapKeyRef: { name: 'not-read', key: 'value' } } };
    const result = observe([{ name, value: 'old' }, indirect]);
    expect(name === 'CLUSTER_ID' ? result.clusterId : result.sharedMeshConfig).toBeUndefined();
    expect(result.configurationWarnings).toContain(`${name} uses indirection and was not resolved`);
    if (name === 'SHARED_MESH_CONFIG') expect(result.effectiveConfigBlocked).toBe(true);
    const resolved = observe([indirect, { name, value: 'last', valueFrom: null }]);
    expect(name === 'CLUSTER_ID' ? resolved.clusterId : resolved.sharedMeshConfig).toBe('last');
    expect(resolved.configurationWarnings).not.toContain(
      `${name} uses indirection and was not resolved`
    );
  }
);
it.each(['1', 'TRUE', 'True', 't', 'False', '0', 'f', 'true ', 'false\n'])(
  'keeps noncanonical EXTERNAL_ISTIOD=%j unresolved rather than using general boolean coercion',
  value => {
    const result = observe([{ name: 'EXTERNAL_ISTIOD', value }]);
    expect(result.managesExternal).toBeNull();
    expect(result.effectiveConfigBlocked).toBe(true);
    expect(result.configurationWarnings).toContain(
      'Noncanonical EXTERNAL_ISTIOD values are not interpreted as resolved topology'
    );
  }
);
it('retains unresolved external indirection even when another assignment is a literal false', () => {
  const result = observe([
    { name: 'EXTERNAL_ISTIOD', valueFrom: { configMapKeyRef: { name: 'not-read', key: 'flag' } } },
    { name: 'EXTERNAL_ISTIOD', value: 'false' },
  ]);
  expect(result.managesExternal).toBeNull();
  expect(result.effectiveConfigBlocked).toBe(true);
  expect(result.configurationWarnings).toContain(
    'EXTERNAL_ISTIOD uses indirection and was not resolved'
  );
});
it.each(
  [
    'invalid',
    [null],
    [{}],
    [{ name: 'CLUSTER_ID', value: 1 }],
    [{ name: 'CLUSTER_ID', valueFrom: 'invalid' }],
  ].map(input => ({ input }))
)('rejects malformed environment evidence %# instead of skipping entries', ({ input }) =>
  expect(() => observe(input)).toThrow('Malformed istiod environment')
);
