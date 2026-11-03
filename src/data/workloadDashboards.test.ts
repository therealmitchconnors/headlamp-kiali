import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { captureWorkloadDashboardEvidence } from '../core/workloadDashboards';
import type { CorrelationSnapshot } from './correlation';
import { loadCorrelationSnapshot } from './correlation';
import { loadWorkloadDashboardSnapshot } from './workloadDashboards';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({ ApiProxy: { request: vi.fn() } }));
vi.mock('./correlation', () => ({ loadCorrelationSnapshot: vi.fn() }));

const scope = { cluster: 'alpha', namespace: 'bookinfo' };
const rc = {
  identity: {
    cluster: 'alpha',
    namespace: 'bookinfo',
    group: '',
    kind: 'ReplicationController' as const,
    name: 'reviews-1',
    uid: 'rc-uid',
  },
  resourceVersion: '4',
  labels: {},
  workloadLabels: { app: 'reviews', version: 'v1' },
  owners: [
    {
      group: 'apps.openshift.io',
      kind: 'DeploymentConfig',
      name: 'reviews',
      uid: 'dc-uid',
      controller: true,
    },
  ],
  serviceSelector: null,
  proxyMode: 'none' as const,
};
const pod = {
  identity: {
    cluster: 'alpha',
    namespace: 'bookinfo',
    group: '',
    kind: 'Pod' as const,
    name: 'reviews-1-abc',
    uid: 'pod-uid',
  },
  resourceVersion: '5',
  labels: { app: 'reviews', version: 'v1' },
  workloadLabels: { app: 'reviews', version: 'v1' },
  owners: [
    {
      group: '',
      kind: 'ReplicationController',
      name: 'reviews-1',
      uid: 'rc-uid',
      controller: true,
    },
  ],
  serviceSelector: null,
  proxyMode: 'none' as const,
  dashboardRefs: { ok: true as const, refs: ['runtime'], bytes: 7 },
};
const correlation = (): CorrelationSnapshot => ({
  scope,
  sources: [],
  resources: [rc, pod],
  complete: true,
});
const deploymentConfig = {
  kind: 'DeploymentConfig',
  apiVersion: 'apps.openshift.io/v1',
  metadata: {
    name: 'reviews',
    namespace: 'bookinfo',
    uid: 'dc-uid',
    resourceVersion: '17',
    labels: { controller: 'metadata' },
  },
  spec: {
    template: {
      metadata: {
        labels: { app: 'reviews', version: 'v1' },
      },
    },
  },
};

beforeEach(() => {
  vi.mocked(ApiProxy.request).mockReset();
  vi.mocked(loadCorrelationSnapshot).mockReset().mockResolvedValue(correlation());
});

it('adds only the selected OpenShift DeploymentConfig to the captured ownership snapshot', async () => {
  vi.mocked(ApiProxy.request).mockResolvedValue(deploymentConfig);
  const result = await loadWorkloadDashboardSnapshot(
    scope,
    { kind: 'DeploymentConfig', name: 'reviews' },
    new AbortController().signal
  );
  expect(result.complete).toBe(true);
  expect(result.resources.map(resource => resource.identity.kind)).toEqual([
    'ReplicationController',
    'Pod',
    'DeploymentConfig',
  ]);
  expect(result.resources[2]).toMatchObject({
    identity: {
      group: 'apps.openshift.io',
      kind: 'DeploymentConfig',
      uid: 'dc-uid',
    },
    resourceVersion: '17',
    workloadLabels: { app: 'reviews', version: 'v1' },
  });
  expect(result.sources.at(-1)).toMatchObject({
    source: { group: 'apps.openshift.io', apiVersion: 'apps.openshift.io/v1' },
    complete: true,
  });
  const evidence = captureWorkloadDashboardEvidence(
    result.scope,
    result.resources,
    result.complete,
    { kind: 'DeploymentConfig', name: 'reviews', uid: 'dc-uid' }
  );
  expect(evidence.pods.map(item => item.name)).toEqual(['reviews-1-abc']);
  expect(evidence.selectors[2].filters).toEqual({ app: 'reviews', version: 'v1' });
  expect(ApiProxy.request).toHaveBeenCalledWith(
    '/apis/apps.openshift.io/v1/namespaces/bookinfo/deploymentconfigs/reviews',
    expect.objectContaining({ cluster: 'alpha' }),
    false
  );
});

it('rejects mismatched scope and denied DeploymentConfig reads without fallback', async () => {
  for (const metadata of [
    { ...deploymentConfig.metadata, namespace: 'other' },
    { ...deploymentConfig.metadata, name: 'replacement' },
  ]) {
    vi.mocked(ApiProxy.request).mockResolvedValueOnce({ ...deploymentConfig, metadata });
    await expect(
      loadWorkloadDashboardSnapshot(
        scope,
        { kind: 'DeploymentConfig', name: 'reviews' },
        new AbortController().signal
      )
    ).rejects.toThrow('identity and scope');
  }

  vi.mocked(ApiProxy.request).mockRejectedValueOnce({ status: 403, message: 'denied' });
  await expect(
    loadWorkloadDashboardSnapshot(
      scope,
      { kind: 'DeploymentConfig', name: 'reviews' },
      new AbortController().signal
    )
  ).rejects.toMatchObject({ status: 403 });
});

it('does not make a DeploymentConfig read for other selected workload kinds', async () => {
  const result = await loadWorkloadDashboardSnapshot(
    scope,
    { kind: 'WorkloadGroup', name: 'vm' },
    new AbortController().signal
  );
  expect(result).toEqual(correlation());
  expect(ApiProxy.request).not.toHaveBeenCalled();
});
