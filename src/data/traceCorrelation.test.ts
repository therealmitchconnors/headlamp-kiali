import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { CorrelationResource, OwnerReference } from '../core/correlation';
import { clusterScope } from '../core/scope';
import { loadCorrelationSnapshot } from './correlation';
import { verifyTracePod, verifyTraceWorkload } from './traceCorrelation';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({ ApiProxy: { request: vi.fn() } }));
vi.mock('./correlation', () => ({ loadCorrelationSnapshot: vi.fn() }));
const identity = { namespace: 'bookinfo', name: 'reviews-1', uid: 'reported-uid' };
const pod = {
  apiVersion: 'v1',
  kind: 'Pod',
  metadata: { namespace: identity.namespace, name: identity.name, uid: identity.uid },
  spec: { containers: [{ name: 'reviews' }] },
};
const owner = (kind: string, name: string, uid: string): OwnerReference => ({
  group: 'apps',
  kind,
  name,
  uid,
  controller: true,
});
const resources: CorrelationResource[] = [
  {
    identity: {
      cluster: 'alpha',
      namespace: 'bookinfo',
      group: '',
      kind: 'Pod',
      name: 'reviews-1',
      uid: 'reported-uid',
    },
    labels: {},
    workloadLabels: {},
    owners: [owner('Deployment', 'reviews-v1', 'deployment-uid')],
    serviceSelector: null,
    proxyMode: 'none',
  },
  {
    identity: {
      cluster: 'alpha',
      namespace: 'bookinfo',
      group: 'apps',
      kind: 'Deployment',
      name: 'reviews-v1',
      uid: 'deployment-uid',
    },
    labels: {},
    workloadLabels: { app: 'reviews' },
    owners: [],
    serviceSelector: null,
    proxyMode: 'none',
  },
];
beforeEach(() => {
  vi.mocked(ApiProxy.request).mockReset().mockResolvedValue(pod);
  vi.mocked(loadCorrelationSnapshot)
    .mockReset()
    .mockResolvedValue({
      scope: { cluster: 'alpha', namespace: 'bookinfo' },
      sources: [],
      resources,
      complete: true,
    });
});
afterEach(() => {
  vi.useRealTimers();
});
it('performs one scoped Pod GET and requires exact UID identity, not a name-only match', async () => {
  const result = await verifyTracePod(
    clusterScope('alpha'),
    identity,
    new AbortController().signal
  );
  expect(result).toMatchObject({ ...identity, cluster: 'alpha' });
  expect(Number.isFinite(Date.parse(result.checkedAt))).toBe(true);
  expect(ApiProxy.request).toHaveBeenCalledTimes(1);
  expect(ApiProxy.request).toHaveBeenCalledWith(
    '/api/v1/namespaces/bookinfo/pods/reviews-1',
    expect.objectContaining({ cluster: 'alpha', autoLogoutOnAuthError: false }),
    false
  );
  vi.mocked(ApiProxy.request).mockResolvedValue({
    ...pod,
    metadata: { ...pod.metadata, uid: 'replacement' },
  });
  await expect(
    verifyTracePod(clusterScope('alpha'), identity, new AbortController().signal)
  ).rejects.toThrow('UID does not match');
});
it('captures immutable request identity and cluster before asynchronous work', async () => {
  const target = { ...identity };
  const scope = { cluster: 'alpha' };
  const pending = verifyTracePod(scope, target, new AbortController().signal);
  target.namespace = 'changed';
  target.uid = 'changed';
  scope.cluster = 'beta';
  expect(await pending).toMatchObject({ ...identity, cluster: 'alpha' });
  expect(vi.mocked(ApiProxy.request).mock.calls[0][1]?.cluster).toBe('alpha');
});
it.each([403, 404])('preserves %s instead of producing a verified link', async status => {
  vi.mocked(ApiProxy.request).mockRejectedValue({
    status,
    message: 'Synthetic Pod lookup failure',
  });
  await expect(
    verifyTracePod(clusterScope('alpha'), identity, new AbortController().signal)
  ).rejects.toMatchObject({ status });
});
it('rejects invalid identity and cancelled work before any request', async () => {
  await expect(
    verifyTracePod(clusterScope('alpha'), { ...identity, uid: '' }, new AbortController().signal)
  ).rejects.toThrow('required');
  const controller = new AbortController();
  controller.abort();
  await expect(
    verifyTracePod(clusterScope('alpha'), identity, controller.signal)
  ).rejects.toThrow();
  expect(ApiProxy.request).not.toHaveBeenCalled();
});
it('enforces a real deadline even if the SDK ignores abort', async () => {
  vi.useFakeTimers();
  vi.mocked(ApiProxy.request).mockImplementation(() => new Promise(() => {}));
  const pending = verifyTracePod(clusterScope('alpha'), identity, new AbortController().signal);
  const assertion = expect(pending).rejects.toThrow('exceeded 15 seconds');
  await vi.advanceTimersByTimeAsync(15000);
  await assertion;
  expect(vi.mocked(ApiProxy.request).mock.calls[0][1]?.signal?.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});
it('does not start a deferred request after immediate cancellation', async () => {
  const controller = new AbortController();
  const pending = verifyTracePod(clusterScope('alpha'), identity, controller.signal);
  controller.abort();
  await expect(pending).rejects.toThrow();
  expect(ApiProxy.request).not.toHaveBeenCalled();
});

it('captures the scope and UID and only returns current workload links from a complete snapshot', async () => {
  const target = { ...identity };
  const scope = { cluster: 'alpha' };
  const pending = verifyTraceWorkload(scope, target, null, new AbortController().signal);
  target.namespace = 'changed';
  target.uid = 'changed';
  scope.cluster = 'beta';
  await expect(pending).resolves.toMatchObject({
    reportedPod: identity,
    cluster: 'alpha',
    namespace: 'bookinfo',
    pod: { kind: 'Pod', uid: 'reported-uid' },
    workload: { kind: 'Deployment', uid: 'deployment-uid' },
    application: { name: 'reviews' },
  });
  expect(loadCorrelationSnapshot).toHaveBeenCalledWith(
    { cluster: 'alpha', namespace: 'bookinfo' },
    expect.any(AbortSignal)
  );
});

it('rejects replaced Pods, incomplete/denied reads, and cancelled ownership snapshots', async () => {
  vi.mocked(loadCorrelationSnapshot).mockResolvedValueOnce({
    scope: { cluster: 'alpha', namespace: 'bookinfo' },
    sources: [],
    resources: resources.map(resource =>
      resource.identity.kind === 'Pod'
        ? { ...resource, identity: { ...resource.identity, uid: 'replacement-uid' } }
        : resource
    ),
    complete: true,
  });
  await expect(
    verifyTraceWorkload(clusterScope('alpha'), identity, null, new AbortController().signal)
  ).rejects.toThrow(/replaced/);

  vi.mocked(loadCorrelationSnapshot).mockResolvedValueOnce({
    scope: { cluster: 'alpha', namespace: 'bookinfo' },
    sources: [
      {
        source: { kind: 'Deployment', group: 'apps', apiVersion: 'apps/v1', plural: 'deployments' },
        resources: [],
        complete: false,
        error: { kind: 'forbidden', message: 'forbidden' },
      },
    ],
    resources: [],
    complete: false,
  });
  await expect(
    verifyTraceWorkload(clusterScope('alpha'), identity, null, new AbortController().signal)
  ).rejects.toThrow(/Deployment: forbidden/);

  vi.mocked(loadCorrelationSnapshot).mockRejectedValueOnce(new Error('Forbidden'));
  await expect(
    verifyTraceWorkload(clusterScope('alpha'), identity, null, new AbortController().signal)
  ).rejects.toThrow('Forbidden');
  const controller = new AbortController();
  controller.abort();
  await expect(
    verifyTraceWorkload(clusterScope('alpha'), identity, null, controller.signal)
  ).rejects.toThrow();
});
