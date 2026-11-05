import { CorrelationKind, CorrelationResource, OwnerReference } from './correlation';
import { namespaceScope } from './scope';
import { virtualWorkloadResources } from './virtualWorkloads';
import { projectWorkloadAccounts, WorkloadAccountCapture } from './workloadInclusion';

const groupFor: Record<CorrelationKind, string> = {
  Deployment: 'apps',
  ReplicaSet: 'apps',
  StatefulSet: 'apps',
  DaemonSet: 'apps',
  ReplicationController: '',
  Job: 'batch',
  CronJob: 'batch',
  DeploymentConfig: 'apps.openshift.io',
  Pod: '',
  WorkloadGroup: 'networking.istio.io',
  Service: '',
};
const versionFor: Record<CorrelationKind, string> = {
  Deployment: 'apps/v1',
  ReplicaSet: 'apps/v1',
  StatefulSet: 'apps/v1',
  DaemonSet: 'apps/v1',
  ReplicationController: 'v1',
  Job: 'batch/v1',
  CronJob: 'batch/v1',
  DeploymentConfig: 'apps.openshift.io/v1',
  Pod: 'v1',
  WorkloadGroup: 'networking.istio.io/v1',
  Service: 'v1',
};
const scope = namespaceScope('alpha', 'bookinfo');

function resource(
  kind: CorrelationKind,
  name: string,
  owners: OwnerReference[] = [],
  serviceAccount?: string
): CorrelationResource {
  return {
    identity: {
      cluster: scope.cluster,
      namespace: scope.namespace,
      group: groupFor[kind],
      kind,
      name,
      uid: `${kind}-${name}`,
    },
    labels: {},
    workloadLabels: {},
    owners,
    serviceSelector: null,
    proxyMode: 'none',
    resourceVersion: `rv-${kind}-${name}`,
    ...(kind === 'Pod'
      ? {
          podAccount:
            serviceAccount === undefined
              ? { ok: false as const, message: 'Pod service account name was not reported' }
              : { ok: true as const, name: serviceAccount },
        }
      : {}),
  };
}

function owner(parent: CorrelationResource, changes: Partial<OwnerReference> = {}): OwnerReference {
  return {
    apiVersion: versionFor[parent.identity.kind],
    group: parent.identity.group,
    kind: parent.identity.kind,
    name: parent.identity.name,
    uid: parent.identity.uid,
    controller: true,
    ...changes,
  };
}

function capture(resources: CorrelationResource[] = []): WorkloadAccountCapture {
  const kinds = [
    'Deployment',
    'ReplicaSet',
    'StatefulSet',
    'DaemonSet',
    'ReplicationController',
    'Job',
    'CronJob',
    'Pod',
    'WorkloadGroup',
    'Service',
  ] as const;
  return {
    scope,
    sources: kinds.map(kind => ({
      source: {
        kind,
        group: groupFor[kind],
        apiVersion: versionFor[kind],
      },
      resources: resources.filter(item => item.identity.kind === kind),
      complete: true,
      resourceVersion: `list-${kind}`,
      ...(kind === 'WorkloadGroup'
        ? resources.some(item => item.identity.kind === kind)
          ? {
              relatedVersions: [
                {
                  kind: 'WorkloadEntry',
                  apiVersion: 'networking.istio.io/v1',
                  resourceVersion: 'list-WorkloadEntry',
                },
              ],
            }
          : { notServed: true }
        : {}),
    })),
    accountSources: [
      {
        source: {
          kind: 'DeploymentConfig',
          group: groupFor.DeploymentConfig,
          apiVersion: versionFor.DeploymentConfig,
        },
        resources: resources.filter(item => item.identity.kind === 'DeploymentConfig'),
        complete: true,
        ...(resources.some(item => item.identity.kind === 'DeploymentConfig')
          ? { resourceVersion: 'list-DeploymentConfig' }
          : { notServed: true }),
      },
    ],
  };
}

it('projects only UID- and API-version-attributed default workloads while keeping app and service sources separate', () => {
  const deployment = resource('Deployment', 'reviews');
  const replicaSet = resource('ReplicaSet', 'reviews-rs', [owner(deployment)]);
  const pod = resource('Pod', 'reviews-pod', [owner(replicaSet)], 'reviews-account');
  const service = resource('Service', 'reviews');
  const data = capture([deployment, replicaSet, pod, service]);
  data.sources = data.sources.map(source =>
    source.source.kind === 'Service' ? { ...source, complete: false } : source
  );
  const result = projectWorkloadAccounts(data);
  expect(result.complete).toBe(true);
  expect(result.workloads).toMatchObject([
    {
      identity: { kind: 'Deployment', uid: deployment.identity.uid },
      pods: [
        { identity: { uid: pod.identity.uid }, account: { ok: true, name: 'reviews-account' } },
      ],
      accounts: [{ name: 'reviews-account', count: 1 }],
    },
  ]);
});

it('includes standalone Pods and controller roots but preserves default exclusions for other controllers', () => {
  const standalone = resource('Pod', 'standalone', [], 'standalone-account');
  const statefulSet = resource('StatefulSet', 'stateful');
  const statefulPod = resource('Pod', 'stateful-pod', [owner(statefulSet)], 'stateful-account');
  const daemonSet = resource('DaemonSet', 'daemon');
  const daemonPod = resource('Pod', 'daemon-pod', [owner(daemonSet)], 'daemon-account');
  const replicaSet = resource('ReplicaSet', 'standalone-rs');
  const replicaSetPod = resource(
    'Pod',
    'replicaset-pod',
    [owner(replicaSet)],
    'replicaset-account'
  );
  const job = resource('Job', 'job');
  const jobPod = resource('Pod', 'job-pod', [owner(job)], 'job-account');
  const rc = resource('ReplicationController', 'rc');
  const rcPod = resource('Pod', 'rc-pod', [owner(rc)], 'rc-account');
  const dc = resource('DeploymentConfig', 'dc');
  const dcPod = resource('Pod', 'dc-pod', [owner(dc)], 'dc-account');
  const cronJob = resource('CronJob', 'cron');
  const cronJobPod = resource('Pod', 'cron-pod', [owner(cronJob)], 'cron-account');
  const data = capture([
    standalone,
    statefulSet,
    statefulPod,
    daemonSet,
    daemonPod,
    replicaSet,
    replicaSetPod,
    job,
    jobPod,
    rc,
    rcPod,
    dc,
    dcPod,
    cronJob,
    cronJobPod,
  ]);
  const result = projectWorkloadAccounts(data);
  expect(result.complete).toBe(true);
  expect(result.workloads.map(item => item.identity.name)).toEqual([
    'daemon',
    'standalone',
    'standalone-rs',
    'stateful',
  ]);
  expect(result.workloads.flatMap(item => item.accounts.map(account => account.name))).toEqual([
    'daemon-account',
    'standalone-account',
    'replicaset-account',
    'stateful-account',
  ]);
});

it.each([
  ['ambiguous', (owner: OwnerReference) => [owner, { ...owner, uid: 'another' }]],
  ['stale UID', (owner: OwnerReference) => [{ ...owner, uid: 'stale' }]],
  ['wrong API version', (owner: OwnerReference) => [{ ...owner, apiVersion: 'apps/v1beta1' }]],
  [
    'custom controller',
    () => [
      {
        apiVersion: 'argoproj.io/v1alpha1',
        group: 'argoproj.io',
        kind: 'Rollout',
        name: 'rollout',
        uid: 'custom',
        controller: true,
      },
    ],
  ],
])('keeps %s ownership explicitly unavailable', (_case, makeOwners) => {
  const deployment = resource('Deployment', 'reviews');
  const pod = resource('Pod', 'reviews-pod', makeOwners(owner(deployment)), 'account');
  const result = projectWorkloadAccounts(capture([deployment, pod]));
  expect(result.complete).toBe(false);
  expect(result.issues.length).toBeGreaterThan(0);
  expect(result.workloads.flatMap(item => item.pods)).toEqual([]);
});

it('does not treat a Pod with non-controller owners as standalone', () => {
  const pod = resource(
    'Pod',
    'owned-by-non-controller',
    [
      {
        apiVersion: 'apps/v1',
        group: 'apps',
        kind: 'ReplicaSet',
        name: 'reviews',
        uid: 'replicaset-reviews',
        controller: false,
      },
    ],
    'account'
  );
  const result = projectWorkloadAccounts(capture([pod]));
  expect(result.complete).toBe(false);
  expect(result.workloads.flatMap(item => item.pods)).toEqual([]);
  expect(result.issues).toContain(
    'Pod/owned-by-non-controller has owner references without a controller'
  );
});

it('preserves namespace and resource-version guards', () => {
  const deployment = resource('Deployment', 'reviews');
  const pod = resource('Pod', 'reviews-pod', [owner(deployment)], 'account');
  const wrongNamespace = capture([deployment, pod]);
  wrongNamespace.sources = wrongNamespace.sources.map(source =>
    source.source.kind === 'Pod'
      ? {
          ...source,
          resources: source.resources.map(item => ({
            ...item,
            identity: { ...item.identity, namespace: 'other' },
          })),
        }
      : source
  );
  expect(projectWorkloadAccounts(wrongNamespace).complete).toBe(false);
  const missingVersion = capture([deployment, pod]);
  missingVersion.sources = missingVersion.sources.map(source =>
    source.source.kind === 'Deployment'
      ? { ...source, resources: source.resources.map(item => ({ ...item, resourceVersion: '' })) }
      : source
  );
  expect(projectWorkloadAccounts(missingVersion).complete).toBe(false);
  const mismatchedApi = capture([deployment, pod]);
  mismatchedApi.sources = mismatchedApi.sources.map(source =>
    source.source.kind === 'Deployment'
      ? {
          ...source,
          source: { ...source.source, apiVersion: 'apps.openshift.io/v1' },
        }
      : source
  );
  expect(projectWorkloadAccounts(mismatchedApi).complete).toBe(false);
});

it('does not complete an account universe with missing or partial source snapshots', () => {
  const snapshot = capture([resource('Pod', 'standalone', [], 'account')]);
  snapshot.sources = snapshot.sources
    .filter(source => source.source.kind !== 'DaemonSet')
    .map(source => (source.source.kind === 'Pod' ? { ...source, complete: false } : source));
  const result = projectWorkloadAccounts(snapshot);
  expect(result.complete).toBe(false);
  expect(result.issues).toContain('DaemonSet source was not captured');
  expect(result.issues).toContain('Pod source is incomplete');
});

it('keeps missing Pod accounts positive-only and incomplete without substituting default', () => {
  const pod = resource('Pod', 'standalone');
  const result = projectWorkloadAccounts(capture([pod]));
  expect(result.complete).toBe(false);
  expect(result.workloads[0]).toMatchObject({
    accounts: [],
    unavailable: [{ uid: pod.identity.uid, message: 'Pod service account name was not reported' }],
  });
});

it('records WorkloadEntry service accounts separately in captured match order', () => {
  const group = virtualWorkloadResources(
    scope,
    [
      {
        name: 'vm',
        namespace: scope.namespace,
        uid: 'group-vm',
        resourceVersion: 'group-version',
        labels: {},
        selector: { app: 'vm' },
      },
    ],
    [
      {
        name: 'entry-z',
        namespace: scope.namespace,
        uid: 'entry-z',
        resourceVersion: 'entry-z-version',
        labels: { app: 'vm' },
        serviceAccount: { ok: true, name: 'vm-account-z' },
      },
      {
        name: 'entry-a',
        namespace: scope.namespace,
        uid: 'entry-a',
        resourceVersion: 'entry-a-version',
        labels: { app: 'vm' },
        serviceAccount: { ok: true, name: 'vm-account-a' },
      },
    ]
  );
  const result = projectWorkloadAccounts(capture(group));
  expect(result.complete).toBe(true);
  expect(result.workloads).toEqual([]);
  expect(result.vmWorkloads[0].entries.map(entry => entry.name)).toEqual(['entry-z', 'entry-a']);
  expect(result.vmWorkloads[0].entries.map(entry => entry.serviceAccount)).toEqual([
    { ok: true, name: 'vm-account-z' },
    { ok: true, name: 'vm-account-a' },
  ]);
});

it('does not import entries for an empty WorkloadGroup selector and marks missing VM accounts unavailable', () => {
  const emptyGroup = virtualWorkloadResources(
    scope,
    [
      {
        name: 'vm-empty',
        namespace: scope.namespace,
        uid: 'group-empty',
        resourceVersion: 'group-version',
        labels: {},
        selector: {},
      },
    ],
    [
      {
        name: 'entry',
        namespace: scope.namespace,
        uid: 'entry',
        resourceVersion: 'entry-version',
        labels: { app: 'vm' },
        serviceAccount: { ok: true, name: 'vm-account' },
      },
    ]
  );
  const emptyResult = projectWorkloadAccounts(capture(emptyGroup));
  expect(emptyResult.complete).toBe(true);
  expect(emptyResult.vmWorkloads[0].entries).toEqual([]);

  const selectedGroup = virtualWorkloadResources(
    scope,
    [
      {
        name: 'vm-selected',
        namespace: scope.namespace,
        uid: 'group-selected',
        resourceVersion: 'group-version',
        labels: {},
        selector: { app: 'vm' },
      },
    ],
    [
      {
        name: 'entry',
        namespace: scope.namespace,
        uid: 'entry',
        resourceVersion: 'entry-version',
        labels: { app: 'vm' },
      },
    ]
  );
  const selectedResult = projectWorkloadAccounts(capture(selectedGroup));
  expect(selectedResult.complete).toBe(false);
  expect(selectedResult.vmWorkloads[0].entries[0].serviceAccount).toMatchObject({
    ok: false,
  });
});
