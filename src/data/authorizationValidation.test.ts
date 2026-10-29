import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { referenceValidation } from '../core/referenceValidation';
import { clusterScope } from '../core/scope';
import { loadValidationSnapshot } from './validation';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  ApiProxy: { request: vi.fn() },
  K8s: { cluster: { KubeObject: class {} } },
}));
const spec = {
  rules: [
    {
      from: [{ source: { namespaces: ['bookinfo', 'missing'] } }],
      to: [{ operation: { methods: ['INVALID', 'G*'] } }],
    },
  ],
};
beforeEach(() => {
  vi.mocked(ApiProxy.request).mockReset();
});
it.each(['found', 'empty', 'denied', 'malformed'])(
  'retains local method checks with %s namespace evidence',
  async mode => {
    vi.mocked(ApiProxy.request).mockImplementation(async path => {
      if (path !== '/api/v1/namespaces?limit=250') throw new Error('Unexpected non-namespace read');
      if (mode === 'denied') throw { status: 403, message: 'Namespace list denied' };
      return {
        kind: 'NamespaceList',
        apiVersion: mode === 'malformed' ? 'wrong/v1' : 'v1',
        metadata: { resourceVersion: '1' },
        items: mode === 'empty' ? [] : [{ metadata: { name: 'bookinfo', uid: 'namespace-uid' } }],
      };
    });
    const signal = new AbortController().signal;
    const snapshot = await loadValidationSnapshot(
      clusterScope('alpha'),
      'AuthorizationPolicy',
      'security.istio.io',
      spec,
      null,
      signal,
      'bookinfo'
    );
    const result = referenceValidation(
      'AuthorizationPolicy',
      'security.istio.io',
      'bookinfo',
      spec,
      snapshot.context
    );
    expect(result.findings.filter(item => item.code === 'KIA0102')).toHaveLength(1);
    expect(result.findings.filter(item => item.code === 'KIA0101')).toHaveLength(
      mode === 'found' ? 1 : mode === 'empty' ? 2 : 0
    );
    expect(result.skipped.length > 0).toBe(mode === 'denied' || mode === 'malformed');
    expect(ApiProxy.request).toHaveBeenCalledWith(
      '/api/v1/namespaces?limit=250',
      expect.objectContaining({ cluster: 'alpha', signal: expect.any(AbortSignal) }),
      false
    );
  }
);
it('does not request Kubernetes context for method-only rules or cancelled namespace reads', async () => {
  const local = { rules: [{ to: [{ operation: { methods: ['invalid'] } }] }] };
  const snapshot = await loadValidationSnapshot(
    clusterScope('alpha'),
    'AuthorizationPolicy',
    'security.istio.io',
    local,
    null,
    new AbortController().signal,
    'bookinfo'
  );
  expect(snapshot.sources).toEqual([]);
  expect(
    referenceValidation(
      'AuthorizationPolicy',
      'security.istio.io',
      'bookinfo',
      local,
      snapshot.context
    ).findings[0].code
  ).toBe('KIA0102');
  const controller = new AbortController();
  controller.abort();
  await expect(
    loadValidationSnapshot(
      clusterScope('alpha'),
      'AuthorizationPolicy',
      'security.istio.io',
      spec,
      null,
      controller.signal,
      'bookinfo'
    )
  ).rejects.toThrow();
  expect(ApiProxy.request).not.toHaveBeenCalled();
});
