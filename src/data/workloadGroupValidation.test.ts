import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { referenceValidation } from '../core/referenceValidation';
import { clusterScope } from '../core/scope';
import { loadValidationSnapshot } from './validation';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  ApiProxy: { request: vi.fn() },
  K8s: { cluster: { KubeObject: class {} } },
}));
const spec = { metadata: { labels: { app: 'reviews' } } };
beforeEach(() => {
  vi.mocked(ApiProxy.request).mockReset();
});
it.each(['complete', 'denied', 'wrong-namespace', 'replaced'])(
  'uses scoped WorkloadGroup evidence for %s',
  async mode => {
    vi.mocked(ApiProxy.request).mockImplementation(async path => {
      if (path === '/apis/networking.istio.io')
        return {
          name: 'networking.istio.io',
          versions: [{ groupVersion: 'networking.istio.io/v1' }],
        };
      if (path === '/apis/networking.istio.io/v1')
        return {
          groupVersion: 'networking.istio.io/v1',
          resources: [{ name: 'workloadgroups', kind: 'WorkloadGroup', namespaced: true }],
        };
      if (path !== '/apis/networking.istio.io/v1/namespaces/bookinfo/workloadgroups?limit=250')
        throw new Error('Unexpected non-scoped WorkloadGroup request');
      if (mode === 'denied') throw { status: 403, message: 'WorkloadGroup list denied' };
      return {
        kind: 'WorkloadGroupList',
        apiVersion: 'networking.istio.io/v1',
        metadata: { resourceVersion: '1' },
        items: [
          {
            metadata: {
              name: 'one',
              namespace: 'bookinfo',
              uid: mode === 'replaced' ? 'replacement' : 'uid-one',
            },
            spec,
          },
          {
            metadata: {
              name: 'two',
              namespace: mode === 'wrong-namespace' ? 'other' : 'bookinfo',
              uid: 'uid-two',
            },
            spec,
          },
        ],
      };
    });
    const snapshot = await loadValidationSnapshot(
      clusterScope('alpha'),
      'WorkloadGroup',
      'networking.istio.io',
      spec,
      null,
      new AbortController().signal,
      'bookinfo'
    );
    expect(snapshot.context.workloadGroups?.namespace).toBe('bookinfo');
    const result = referenceValidation(
      'WorkloadGroup',
      'networking.istio.io',
      'bookinfo',
      spec,
      snapshot.context,
      { name: 'one', uid: 'uid-one' }
    );
    expect(result.findings.map(item => item.code)).toEqual(mode === 'complete' ? ['KIA1702'] : []);
    expect(result.skipped.length > 0).toBe(mode !== 'complete');
    expect(
      vi.mocked(ApiProxy.request).mock.calls.every(([, options]) => options?.cluster === 'alpha')
    ).toBe(true);
  }
);
it('does not silently widen a missing namespace or read after cancellation', async () => {
  const missing = await loadValidationSnapshot(
    clusterScope('alpha'),
    'WorkloadGroup',
    'networking.istio.io',
    spec,
    null,
    new AbortController().signal
  );
  expect(missing.context.workloadGroups?.complete).toBe(false);
  expect(missing.sources[0].error?.message).toContain('namespace is required');
  const controller = new AbortController();
  controller.abort();
  await expect(
    loadValidationSnapshot(
      clusterScope('alpha'),
      'WorkloadGroup',
      'networking.istio.io',
      spec,
      null,
      controller.signal,
      'bookinfo'
    )
  ).rejects.toThrow();
  expect(ApiProxy.request).not.toHaveBeenCalled();
});
