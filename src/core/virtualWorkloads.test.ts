import oracleText from '../../test-files/parity/virtual-workload-labels-oracle.json?raw';
import { correlateResources, CorrelationResource } from './correlation';
import { applicationReplicaEvidence } from './entityHealth';
import { graphResourceCandidates } from './graphResources';
import { Labels } from './labels';
import { namespaceScope } from './scope';
import { serviceTrafficVersions } from './serviceTraffic';
import {
  VirtualWorkloadGroup,
  VirtualWorkloadRecord,
  virtualWorkloadResources,
} from './virtualWorkloads';

const scope = namespaceScope('alpha', 'bookinfo');
const group = (name = 'vm', selector: Labels = { app: 'vm' }): VirtualWorkloadGroup => ({
  name,
  namespace: 'bookinfo',
  uid: `group-${name}`,
  resourceVersion: 'group-version',
  labels: { app: 'metadata-is-not-the-workload' },
  selector,
});
const entry = (
  name = 'one',
  labels: Labels = { app: 'vm', version: 'v1' }
): VirtualWorkloadRecord => ({
  name,
  namespace: 'bookinfo',
  uid: `entry-${name}`,
  resourceVersion: `entry-version-${name}`,
  labels,
});
const oracle: {
  cases: {
    input: { selector: Labels | null; entries: { name: string; labels: Labels | null }[] };
    expected: { labels: Labels; count: number; first: string };
  }[];
} = JSON.parse(oracleText);
it.each(oracle.cases)('matches original WorkloadGroup label branch %#', ({ input, expected }) => {
  const [resource] = virtualWorkloadResources(
    scope,
    [group('vm', input.selector ?? {})],
    input.entries.map(item => entry(item.name, item.labels ?? {}))
  );
  expect(resource.workloadLabels).toEqual(expected.labels);
  expect(resource.virtualMachine?.matchingEntries).toBe(expected.count);
  expect(resource.virtualMachine?.entry?.name ?? '').toBe(expected.first);
  expect(resource.identity.uid).toBe('group-vm');
  expect(resource.resourceVersion).toBe('group-version');
});
it('retains group identity, first-entry provenance and separate non-Pod health', () => {
  const records = virtualWorkloadResources(
    scope,
    [group()],
    [entry(), entry('two', { app: 'vm', version: 'v2' })]
  );
  const [resource] = records;
  expect(resource.virtualMachine).toEqual({
    labelSource: 'entry',
    matchingEntries: 2,
    entry: { name: 'one', uid: 'entry-one', resourceVersion: 'entry-version-one' },
  });
  const relation = correlateResources(records);
  expect(relation.workloads[0].pods).toEqual([]);
  expect(relation.applications[0].versions).toEqual(['v1']);
  expect(applicationReplicaEvidence(relation.applications[0])).toEqual({
    statuses: [],
    issues: ['WorkloadGroup/vm: replica health is not supported or was not collected'],
  });
  const candidates = graphResourceCandidates(
    { cluster: 'alpha', namespace: 'bookinfo', kind: 'workload', names: ['vm'] },
    records
  );
  expect(candidates.candidates[0]).toMatchObject({
    identity: { kind: 'WorkloadGroup', uid: 'group-vm' },
    app: 'vm',
    version: 'v1',
    virtualMachine: resource.virtualMachine,
  });
  const service: CorrelationResource = {
    identity: {
      cluster: 'alpha',
      namespace: 'bookinfo',
      group: '',
      kind: 'Service',
      name: 'vm',
      uid: 'service-vm',
    },
    labels: {},
    workloadLabels: {},
    owners: [],
    serviceSelector: { app: 'vm' },
    proxyMode: 'none',
  };
  const matched = correlateResources([...records, service]).serviceRelations[0];
  expect(matched.workloads).toHaveLength(1);
  expect(matched.pods).toEqual([]);
  expect(() => serviceTrafficVersions(matched)).toThrow('per-entry version evidence');
});
it('does not adopt Pods whose owner reference points at a WorkloadGroup', () => {
  const [vm] = virtualWorkloadResources(scope, [group()], [entry()]);
  const pod: CorrelationResource = {
    ...vm,
    identity: { ...vm.identity, group: '', kind: 'Pod', uid: 'pod', name: 'pod' },
    owners: [
      {
        group: 'networking.istio.io',
        kind: 'WorkloadGroup',
        name: 'vm',
        uid: 'group-vm',
        controller: true,
      },
    ],
    virtualMachine: undefined,
  };
  const correlated = correlateResources([vm, pod]);
  expect(correlated.workloads[0].pods).toEqual([]);
  expect(correlated.issues[0].reason).toBe('unsupported-owner');
});
it('copies selected labels rather than aliasing later caller changes', () => {
  const labels = { app: 'vm', version: 'v1' };
  const original = entry('one', labels);
  const [resource] = virtualWorkloadResources(scope, [group()], [original]);
  labels.version = 'changed';
  expect(resource.workloadLabels.version).toBe('v1');
});
it.each(['namespace', 'uid', 'version', 'duplicate'])(
  'rejects invalid %s source identity',
  mode => {
    const one = entry();
    if (mode === 'namespace') one.namespace = 'other';
    if (mode === 'uid') one.uid = '';
    if (mode === 'version') one.resourceVersion = '';
    expect(() =>
      virtualWorkloadResources(scope, [group()], mode === 'duplicate' ? [one, one] : [one])
    ).toThrow('identities');
  }
);
it('bounds record counts and exact selector comparisons, skipping empty selectors', () => {
  const groups = Array.from({ length: 1000 }, (_, i) => group(`g${i}`));
  const entries = Array.from({ length: 10 }, (_, i) => entry(`e${i}`));
  expect(virtualWorkloadResources(scope, groups, entries)).toHaveLength(1000);
  expect(() => virtualWorkloadResources(scope, groups, [...entries, entry('extra')])).toThrow(
    '10000'
  );
  expect(() => virtualWorkloadResources(scope, [...groups, group('extra')], [])).toThrow(
    '1000 groups'
  );
  expect(
    virtualWorkloadResources(
      scope,
      groups.map(item => ({ ...item, selector: {} })),
      entries
    )
  ).toHaveLength(1000);
});

it('enforces the exact aggregate label-text budget across captured VM evidence', () => {
  const labels = Object.fromEntries(
    Array.from({ length: 100 }, (_, index) => [
      `key${String(index).padStart(3, '0')}`,
      'x'.repeat(994),
    ])
  );
  const groups = [{ ...group('vm', {}), labels: {} }];
  const entries = Array.from({ length: 10 }, (_, index) => entry(`e${index}`, labels));
  expect(virtualWorkloadResources(scope, groups, entries)).toHaveLength(1);
  expect(() =>
    virtualWorkloadResources(scope, groups, [...entries, entry('extra', { x: '' })])
  ).toThrow('1,000,000 characters');
});
