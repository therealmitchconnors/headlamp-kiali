import { clusterScope } from '../core/scope';
import { readCluster } from './requests';
import { loadZtunnelResourceCandidate } from './ztunnelResourceCandidate';

vi.mock('./requests', async () => {
  const actual = await vi.importActual<typeof import('./requests')>('./requests');
  return { ...actual, readCluster: vi.fn() };
});

const target = { kind: 'Pod' as const, namespace: 'bookinfo', name: 'reviews-a' };
const current = {
  apiVersion: 'v1',
  kind: 'Pod',
  metadata: {
    name: target.name,
    namespace: target.namespace,
    uid: 'current-pod-uid',
    resourceVersion: '42',
  },
};

beforeEach(() => {
  vi.useRealTimers();
  vi.mocked(readCluster).mockReset().mockResolvedValue(current);
});
afterEach(() => vi.useRealTimers());

it('verifies exact current resource identity and captures its UID and version', async () => {
  const result = await loadZtunnelResourceCandidate(
    clusterScope('alpha'),
    target,
    new AbortController().signal
  );
  expect(readCluster).toHaveBeenCalledWith(
    { cluster: 'alpha', namespace: 'bookinfo' },
    '/api/v1/namespaces/bookinfo/pods/reviews-a',
    expect.any(AbortSignal)
  );
  expect(result).toMatchObject({
    scope: { cluster: 'alpha', namespace: 'bookinfo' },
    ...target,
    uid: 'current-pod-uid',
    resourceVersion: '42',
  });
});

it('uses the captured namespace/name for a current Service candidate', async () => {
  const serviceTarget = { kind: 'Service' as const, namespace: 'bookinfo', name: 'reviews' };
  vi.mocked(readCluster).mockResolvedValueOnce({
    apiVersion: 'v1',
    kind: 'Service',
    metadata: {
      name: serviceTarget.name,
      namespace: serviceTarget.namespace,
      uid: 'current-service-uid',
      resourceVersion: '84',
    },
  });
  const result = await loadZtunnelResourceCandidate(
    clusterScope('alpha'),
    serviceTarget,
    new AbortController().signal
  );
  expect(readCluster).toHaveBeenCalledWith(
    { cluster: 'alpha', namespace: 'bookinfo' },
    '/api/v1/namespaces/bookinfo/services/reviews',
    expect.any(AbortSignal)
  );
  expect(result).toMatchObject({
    kind: 'Service',
    uid: 'current-service-uid',
    resourceVersion: '84',
  });
});

it.each([
  ['kind', { ...current, kind: 'Service' }],
  ['namespace', { ...current, metadata: { ...current.metadata, namespace: 'other' } }],
  ['name', { ...current, metadata: { ...current.metadata, name: 'different' } }],
  ['API version', { ...current, apiVersion: 'v1beta1' }],
  ['UID', { ...current, metadata: { ...current.metadata, uid: '' } }],
  ['resource version', { ...current, metadata: { ...current.metadata, resourceVersion: '' } }],
])('rejects a current %s identity mismatch', async (_field, value) => {
  vi.mocked(readCluster).mockResolvedValueOnce(value);
  await expect(
    loadZtunnelResourceCandidate(clusterScope('alpha'), target, new AbortController().signal)
  ).rejects.toThrow();
});

it('propagates denied target reads and rejects malformed candidate scope before transport', async () => {
  vi.mocked(readCluster).mockRejectedValueOnce(Object.assign(new Error('denied'), { status: 403 }));
  await expect(
    loadZtunnelResourceCandidate(clusterScope('alpha'), target, new AbortController().signal)
  ).rejects.toThrow('denied');
  await expect(
    loadZtunnelResourceCandidate(
      clusterScope('alpha'),
      { kind: 'Pod', namespace: 'bookinfo', name: 'bad/name' },
      new AbortController().signal
    )
  ).rejects.toThrow('does not identify');
  expect(readCluster).toHaveBeenCalledTimes(1);
});

it('does not return a late target response after cancellation', async () => {
  let resolve: (value: unknown) => void = () => {};
  vi.mocked(readCluster).mockReturnValueOnce(
    new Promise(done => {
      resolve = done;
    })
  );
  const controller = new AbortController();
  const pending = loadZtunnelResourceCandidate(clusterScope('alpha'), target, controller.signal);
  await vi.waitFor(() => expect(readCluster).toHaveBeenCalled());
  controller.abort();
  await expect(pending).rejects.toThrow('cancelled');
  resolve(current);
  await Promise.resolve();
  expect(readCluster).toHaveBeenCalledTimes(1);
});
