import { correlateResources, CorrelationResource } from './correlation';
import { observedPodAccount, workloadPodAccounts } from './workloadAccounts';

const controller: CorrelationResource = {
  identity: {
    cluster: 'alpha',
    namespace: 'bookinfo',
    group: 'apps',
    kind: 'Deployment',
    name: 'reviews',
    uid: 'controller',
  },
  labels: {},
  workloadLabels: { app: 'reviews' },
  owners: [],
  serviceSelector: null,
  proxyMode: 'none',
};
const pod = (name: string, value: unknown): CorrelationResource => ({
  ...controller,
  identity: { ...controller.identity, group: '', kind: 'Pod', name, uid: `pod-${name}` },
  owners: [
    { group: 'apps', kind: 'Deployment', name: 'reviews', uid: 'controller', controller: true },
  ],
  podAccount: observedPodAccount({ serviceAccountName: value }),
});
const workload = (pods: CorrelationResource[]) =>
  correlateResources([controller, ...pods]).workloads[0];
it('retains explicit names, missing values and malformed values without inventing default', () => {
  expect(observedPodAccount({ serviceAccountName: 'default' })).toEqual({
    ok: true,
    name: 'default',
  });
  expect(observedPodAccount({ serviceAccountName: 'custom.account' })).toEqual({
    ok: true,
    name: 'custom.account',
  });
  for (const value of [undefined, ''])
    expect(observedPodAccount({ serviceAccountName: value })).toMatchObject({
      ok: false,
      message: expect.stringContaining('no default was inferred'),
    });
  for (const value of [null, 1, [], 'account ', 'x'.repeat(254), 'a/b'])
    expect(observedPodAccount({ serviceAccountName: value })).toMatchObject({
      ok: false,
      message: expect.stringContaining('malformed'),
    });
});
it('aggregates only scoped UID-attributed Pods and preserves incomplete evidence', () => {
  const actual = workloadPodAccounts(
    workload([
      pod('one', 'account-b'),
      pod('two', 'account-a'),
      pod('three', 'account-b'),
      pod('four', undefined),
    ])
  );
  expect(actual.accounts).toEqual([
    { name: 'account-a', count: 1 },
    { name: 'account-b', count: 2 },
  ]);
  expect(actual.observedPods).toBe(4);
  expect(actual.unavailable).toMatchObject([
    { name: 'four', uid: 'pod-four', message: expect.any(String) },
  ]);
});
it('does not use controller metadata or unresolved Pod owners as account evidence', () => {
  const unresolved = pod('unresolved', 'not-attributed');
  unresolved.owners = [{ ...unresolved.owners[0], uid: 'missing' }];
  const model = correlateResources([
    { ...controller, labels: { serviceAccountName: 'wrong' } },
    unresolved,
  ]);
  expect(model.issues[0].reason).toBe('unresolved-owner');
  expect(workloadPodAccounts(model.workloads[0])).toEqual({
    accounts: [],
    unavailable: [],
    observedPods: 0,
  });
});
it.each(['namespace', 'cluster', 'kind', 'duplicate'])(
  'rejects invalid attributed %s evidence',
  mode => {
    const value = workload([pod('one', 'account')]);
    if (mode === 'namespace') value.pods[0].identity.namespace = 'other';
    if (mode === 'cluster') value.pods[0].identity = { ...value.pods[0].identity, cluster: 'other' };
    if (mode === 'kind') value.pods[0].identity.kind = 'WorkloadGroup';
    if (mode === 'duplicate') value.pods.push(value.pods[0]);
    expect(() => workloadPodAccounts(value)).toThrow('duplicate or outside');
  }
);
it('bounds attributed Pods at exactly 1000 and keeps VM accounts out of this evidence', () => {
  const actual = workload(Array.from({ length: 1000 }, (_, i) => pod(`p${i}`, 'account')));
  expect(workloadPodAccounts(actual).accounts).toEqual([{ name: 'account', count: 1000 }]);
  actual.pods.push(pod('extra', 'account'));
  expect(() => workloadPodAccounts(actual)).toThrow('1000');
  const vm = {
    ...actual,
    identity: { ...actual.identity, kind: 'WorkloadGroup' as const },
    pods: [],
  };
  expect(workloadPodAccounts(vm)).toEqual({ accounts: [], unavailable: [], observedPods: 0 });
  vm.pods = [pod('not-vm', 'account')];
  expect(() => workloadPodAccounts(vm)).toThrow('WorkloadEntries cannot');
});
