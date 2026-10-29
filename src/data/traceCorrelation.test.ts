import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { clusterScope } from '../core/scope';
import { verifyTracePod } from './traceCorrelation';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({ ApiProxy: { request: vi.fn() } }));
const identity = { namespace: 'bookinfo', name: 'reviews-1', uid: 'reported-uid' };
const pod = {
  apiVersion: 'v1',
  kind: 'Pod',
  metadata: { namespace: identity.namespace, name: identity.name, uid: identity.uid },
  spec: { containers: [{ name: 'reviews' }] },
};
beforeEach(() => {
  vi.mocked(ApiProxy.request).mockReset().mockResolvedValue(pod);
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
