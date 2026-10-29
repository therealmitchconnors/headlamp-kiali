import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { gatewayReferenceValidation } from '../core/gatewayValidation';
import { clusterScope } from '../core/scope';
import { loadValidationSnapshot } from './validation';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  ApiProxy: { request: vi.fn() },
  K8s: { cluster: { KubeObject: class {} } },
}));
const group = 'gateway.networking.k8s.io';
const spec = {
  parentRefs: [{ name: 'public', namespace: 'edge' }],
  rules: [{ backendRefs: [{ name: 'remote', namespace: 'edge' }] }],
};
const item = (name: string, namespace?: string, spec = {}) => ({
  metadata: { name, namespace, uid: `${namespace ?? ''}/${name}` },
  spec,
});
const list = (kind: string, apiVersion: string, items: unknown[]) => ({
  kind: `${kind}List`,
  apiVersion,
  metadata: { resourceVersion: '1' },
  items,
});
beforeEach(() => {
  vi.mocked(ApiProxy.request).mockReset();
});

it.each(['ready', 'denied-grants', 'denied-namespaces'])(
  'keeps Gateway-group discovery and %s evidence scoped with at most three active reads',
  async mode => {
    let active = 0;
    let peak = 0;
    vi.mocked(ApiProxy.request).mockImplementation(async path => {
      active++;
      peak = Math.max(peak, active);
      try {
        await new Promise(resolve => setTimeout(resolve, 1));
        const url = new URL(String(path), 'http://example.test');
        if (url.pathname === `/apis/${group}`)
          return {
            name: group,
            versions: [{ groupVersion: `${group}/v1` }, { groupVersion: `${group}/v1beta1` }],
          };
        if (url.pathname === `/apis/${group}/v1`)
          return {
            groupVersion: `${group}/v1`,
            resources: [{ name: 'gateways', kind: 'Gateway', namespaced: true }],
          };
        if (url.pathname === `/apis/${group}/v1beta1`)
          return {
            groupVersion: `${group}/v1beta1`,
            resources: [{ name: 'referencegrants', kind: 'ReferenceGrant', namespaced: true }],
          };
        if (url.pathname.endsWith('/gateways'))
          return list('Gateway', `${group}/v1`, [
            item('public', 'edge', {
              listeners: [{ allowedRoutes: { namespaces: { from: 'All' } } }],
            }),
          ]);
        if (url.pathname.endsWith('/referencegrants')) {
          if (mode === 'denied-grants') throw { status: 403, message: 'Grant access denied' };
          return list('ReferenceGrant', `${group}/v1beta1`, [
            item('grant', 'edge', {
              from: [{ group, kind: 'HTTPRoute', namespace: 'bookinfo' }],
              to: [{ group: '', kind: 'Service', name: 'remote' }],
            }),
          ]);
        }
        if (url.pathname === '/api/v1/services')
          return list('Service', 'v1', [item('remote', 'edge')]);
        if (url.pathname === '/api/v1/namespaces') {
          if (mode === 'denied-namespaces')
            throw { status: 403, message: 'Namespace access denied' };
          return list('Namespace', 'v1', [item('bookinfo'), item('edge')]);
        }
        throw new Error(`Unexpected request: ${path}`);
      } finally {
        active--;
      }
    });
    const signal = new AbortController().signal;
    const result = await loadValidationSnapshot(
      clusterScope('alpha'),
      'HTTPRoute',
      group,
      spec,
      null,
      signal,
      'bookinfo'
    );
    expect(peak).toBeLessThanOrEqual(3);
    expect(result.context.gateways?.complete).toBe(true);
    expect(result.context.services?.complete).toBe(true);
    const checks = gatewayReferenceValidation('HTTPRoute', group, 'bookinfo', spec, result.context);
    expect(checks.findings).toEqual([]);
    if (mode === 'ready') {
      expect(result.sources.every(source => source.complete)).toBe(true);
      expect(checks.skipped).toHaveLength(1);
    } else {
      expect(result.sources.some(source => source.error?.kind === 'forbidden')).toBe(true);
      expect(checks.skipped.some(message => message.includes('complete'))).toBe(true);
    }
    for (const [path, options] of vi.mocked(ApiProxy.request).mock.calls) {
      expect(options).toMatchObject({ cluster: 'alpha', signal: expect.any(AbortSignal) });
      expect(options?.method).toBeUndefined();
      expect(path).not.toContain('networking.istio.io');
      expect(path).not.toContain('/configmaps/');
      expect(path).not.toContain('/secrets/');
    }
  }
);
it('treats an absent Gateway API as unavailable evidence rather than an empty confirmed parent list', async () => {
  vi.mocked(ApiProxy.request).mockRejectedValue({ status: 404, message: 'API absent' });
  const result = await loadValidationSnapshot(
    clusterScope('alpha'),
    'HTTPRoute',
    group,
    { parentRefs: [{ name: 'missing' }] },
    null,
    new AbortController().signal,
    'bookinfo'
  );
  expect(result.context.gateways?.complete).toBe(false);
  const checks = gatewayReferenceValidation(
    'HTTPRoute',
    group,
    'bookinfo',
    { parentRefs: [{ name: 'missing' }] },
    result.context
  );
  expect(checks.findings).toEqual([]);
  expect(checks.skipped[0]).toContain('complete Gateway API list');
});
