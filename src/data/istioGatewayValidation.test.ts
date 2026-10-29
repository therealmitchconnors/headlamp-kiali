import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { referenceValidation } from '../core/referenceValidation';
import { clusterScope } from '../core/scope';
import { loadValidationSnapshot } from './validation';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  ApiProxy: { request: vi.fn() },
  K8s: { cluster: { KubeObject: class {} } },
}));
const spec = { gateways: ['edge/public'] };
beforeEach(() => {
  vi.mocked(ApiProxy.request).mockReset();
});
it.each(['found', 'missing', 'denied', 'wrong-group'])(
  'uses group-safe scoped Istio Gateway evidence for %s',
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
          resources: [{ name: 'gateways', kind: 'Gateway', namespaced: true }],
        };
      if (String(path) !== '/apis/networking.istio.io/v1/gateways?limit=250')
        throw new Error(`Unexpected validation request: ${path}`);
      if (mode === 'denied') throw { status: 403, message: 'Gateway list denied' };
      return {
        apiVersion:
          mode === 'wrong-group' ? 'gateway.networking.k8s.io/v1' : 'networking.istio.io/v1',
        kind: 'GatewayList',
        metadata: { resourceVersion: '1' },
        items:
          mode === 'missing'
            ? []
            : [
                {
                  metadata: { name: 'public', namespace: 'edge', uid: 'gateway-uid' },
                  spec: {},
                },
              ],
      };
    });
    const controller = new AbortController();
    const snapshot = await loadValidationSnapshot(
      clusterScope('alpha'),
      'VirtualService',
      'networking.istio.io',
      spec,
      null,
      controller.signal,
      'bookinfo'
    );
    const result = referenceValidation(
      'VirtualService',
      'networking.istio.io',
      'bookinfo',
      spec,
      snapshot.context
    );
    expect(snapshot.sources.map(item => item.key)).toEqual(['istioGateways']);
    expect(snapshot.context.gateways?.complete).toBe(false);
    expect(snapshot.context.istioGateways?.complete).toBe(mode === 'found' || mode === 'missing');
    expect(result.findings.map(item => item.code)).toEqual(mode === 'missing' ? ['KIA1102'] : []);
    expect(result.skipped.length > 0).toBe(mode === 'denied' || mode === 'wrong-group');
    for (const [path, options] of vi.mocked(ApiProxy.request).mock.calls) {
      expect(path).not.toContain('gateway.networking.k8s.io');
      expect(options).toMatchObject({ cluster: 'alpha', signal: expect.any(AbortSignal) });
    }
  }
);
it('does not request unneeded sources or read after cancellation', async () => {
  for (const gateways of [['mesh'], ['legacy.gateway']]) {
    const snapshot = await loadValidationSnapshot(
      clusterScope('alpha'),
      'VirtualService',
      'networking.istio.io',
      { gateways },
      null,
      new AbortController().signal,
      'bookinfo'
    );
    expect(snapshot.sources).toEqual([]);
  }
  const controller = new AbortController();
  controller.abort();
  await expect(
    loadValidationSnapshot(
      clusterScope('alpha'),
      'VirtualService',
      'networking.istio.io',
      spec,
      null,
      controller.signal,
      'bookinfo'
    )
  ).rejects.toThrow();
  expect(ApiProxy.request).not.toHaveBeenCalled();
});
