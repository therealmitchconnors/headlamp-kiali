import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { gatewayCollisionChecks } from '../core/gatewayCollisions';
import { clusterScope } from '../core/scope';
import { loadValidationSnapshot } from './validation';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  ApiProxy: { request: vi.fn() },
  K8s: { cluster: { KubeObject: class {} } },
}));
const group = 'gateway.networking.k8s.io';
const spec = {
  gatewayClassName: 'istio',
  listeners: [{ name: 'http', hostname: 'example.com', port: 80, protocol: 'HTTP' }],
  addresses: [{ type: 'IPAddress', value: '10.0.0.1' }],
};
beforeEach(() => {
  vi.mocked(ApiProxy.request).mockReset();
});
it.each(['ready', 'denied', 'replaced'])(
  'loads Gateway conflict evidence from %s sources without crossing API groups',
  async mode => {
    vi.mocked(ApiProxy.request).mockImplementation(async path => {
      const url = new URL(String(path), 'http://example.test');
      if (url.pathname === `/apis/${group}`)
        return { name: group, versions: [{ groupVersion: `${group}/v1` }] };
      if (url.pathname === `/apis/${group}/v1`)
        return {
          groupVersion: `${group}/v1`,
          resources: [{ name: 'gateways', kind: 'Gateway', namespaced: true }],
        };
      if (url.pathname === `/apis/${group}/v1/gateways`) {
        if (mode === 'denied') throw { status: 403, message: 'Gateway list denied' };
        return {
          kind: 'GatewayList',
          apiVersion: `${group}/v1`,
          metadata: { resourceVersion: '1' },
          items: [
            {
              metadata: {
                name: 'selected',
                namespace: 'bookinfo',
                uid: mode === 'replaced' ? 'changed' : 'selected-uid',
              },
              spec,
            },
            { metadata: { name: 'peer', namespace: 'edge', uid: 'peer-uid' }, spec },
          ],
        };
      }
      throw new Error(`Unexpected request ${path}`);
    });
    const signal = new AbortController().signal;
    const snapshot = await loadValidationSnapshot(
      clusterScope('alpha'),
      'Gateway',
      group,
      spec,
      null,
      signal,
      'bookinfo',
      { classes: [{ name: 'Istio', className: 'istio' }], selector: {} }
    );
    const result = gatewayCollisionChecks('Gateway', group, 'bookinfo', spec, snapshot.context, {
      name: 'selected',
      uid: 'selected-uid',
    });
    expect(result.findings.map(finding => finding.code)).toEqual(
      mode === 'ready' ? ['KIA1502', 'KIA1501'] : []
    );
    expect(snapshot.context.gatewayClassRegistry?.basis).toBe('configured');
    expect(
      vi
        .mocked(ApiProxy.request)
        .mock.calls.every(
          ([path, options]) =>
            String(path).startsWith(`/apis/${group}`) && options?.cluster === 'alpha'
        )
    ).toBe(true);
  }
);
