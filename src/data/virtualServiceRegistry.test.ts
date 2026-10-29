import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { referenceValidation } from '../core/referenceValidation';
import { clusterScope } from '../core/scope';
import { loadValidationSnapshot } from './validation';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  ApiProxy: { request: vi.fn() },
  K8s: { cluster: { KubeObject: class {} } },
}));
const group = 'networking.istio.io';
const collection = (kind: string, apiVersion: string, items: unknown[]) => ({
  kind: `${kind}List`,
  apiVersion,
  metadata: { resourceVersion: '1' },
  items,
});
beforeEach(() => {
  vi.mocked(ApiProxy.request).mockReset();
});
it.each([
  ['default', 'warning'],
  ['allow-any', 'warning'],
  ['registry-only', 'error'],
  ['dynamic-dns', 'error'],
  ['empty-policy', 'error'],
  ['shared-registry', 'error'],
  ['local-allow', 'warning'],
  ['local-zero', 'error'],
  ['denied-mesh', null],
  ['denied-services', null],
  ['invalid-mode', null],
  ['service-present', null],
] as const)(
  'uses %s outbound policy and captured registry source requirements',
  async (mode, severity) => {
    vi.mocked(ApiProxy.request).mockImplementation(async path => {
      const url = new URL(String(path), 'http://example.test');
      if (url.pathname === '/apis/networking.istio.io')
        return { name: group, versions: [{ groupVersion: `${group}/v1` }] };
      if (url.pathname === '/apis/networking.istio.io/v1')
        return {
          groupVersion: `${group}/v1`,
          resources: [{ name: 'serviceentries', kind: 'ServiceEntry', namespaced: true }],
        };
      if (url.pathname === '/api/v1/namespaces')
        return collection(
          'Namespace',
          'v1',
          ['bookinfo', 'root'].map(name => ({
            metadata: { name, uid: name, labels: { 'istio.io/rev': 'blue' } },
          }))
        );
      if (url.pathname === '/api/v1/services') {
        if (mode === 'denied-services') throw { status: 403, message: 'Services denied' };
        return collection(
          'Service',
          'v1',
          mode === 'service-present'
            ? [
                {
                  metadata: { name: 'reviews', namespace: 'bookinfo', uid: 'svc' },
                  spec: {},
                },
              ]
            : []
        );
      }
      if (url.pathname.endsWith('/serviceentries'))
        return collection('ServiceEntry', `${group}/v1`, []);
      if (url.pathname === '/apis/apps/v1/deployments')
        return collection('Deployment', 'apps/v1', [
          {
            metadata: {
              name: 'istiod-blue',
              namespace: 'root',
              uid: 'cp',
              labels: { app: 'istiod', 'istio.io/rev': 'blue' },
            },
            spec: {
              template: {
                spec: {
                  containers: [
                    {
                      name: 'discovery',
                      env: ['shared-registry', 'local-allow', 'local-zero'].includes(mode)
                        ? [{ name: 'SHARED_MESH_CONFIG', value: 'shared' }]
                        : [],
                    },
                  ],
                },
              },
            },
          },
        ]);
      if (url.pathname.endsWith('/mutatingwebhookconfigurations'))
        return collection('MutatingWebhookConfiguration', 'admissionregistration.k8s.io/v1', []);
      if (url.pathname.includes('/configmaps/')) {
        if (mode === 'denied-mesh') throw { status: 403, message: 'Mesh denied' };
        const name = url.pathname.split('/').pop();
        const policy =
          name === 'shared'
            ? 'outboundTrafficPolicy: {mode: REGISTRY_ONLY}'
            : ['allow-any', 'local-allow'].includes(mode)
            ? 'outboundTrafficPolicy: {mode: ALLOW_ANY}'
            : mode === 'dynamic-dns'
            ? 'outboundTrafficPolicy: {mode: ALLOW_ANY_DYNAMIC_DNS}'
            : mode === 'registry-only'
            ? 'outboundTrafficPolicy: {mode: REGISTRY_ONLY}'
            : ['empty-policy', 'local-zero'].includes(mode)
            ? 'outboundTrafficPolicy: {}'
            : mode === 'invalid-mode'
            ? 'outboundTrafficPolicy: {mode: unsupported}'
            : '';
        return {
          kind: 'ConfigMap',
          apiVersion: 'v1',
          metadata: { name, namespace: 'root' },
          data: name?.includes('sidecar-injector')
            ? { values: '{}' }
            : { mesh: `rootNamespace: root\n${policy}` },
        };
      }
      throw new Error(`Unexpected request ${path}`);
    });
    const input = { http: [{ route: [{ destination: { host: 'reviews' } }] }] };
    const captured = structuredClone(input);
    const signal = new AbortController().signal;
    const pending = loadValidationSnapshot(
      clusterScope('alpha'),
      'VirtualService',
      group,
      input,
      'svc.cluster.local',
      signal,
      'bookinfo'
    );
    input.http = [];
    const snapshot = await pending;
    expect(snapshot.sources.map(source => source.key)).toEqual([
      'namespaces',
      'services',
      'serviceEntries',
    ]);
    const result = referenceValidation(
      'VirtualService',
      group,
      'bookinfo',
      captured,
      snapshot.context
    );
    expect(result.findings.map(finding => [finding.code, finding.severity])).toEqual(
      severity ? [['KIA1101', severity]] : []
    );
    expect(result.skipped).toHaveLength(
      ['denied-mesh', 'denied-services', 'invalid-mode'].includes(mode) ? 1 : 0
    );
    for (const [path, options] of vi.mocked(ApiProxy.request).mock.calls) {
      expect(options).toMatchObject({ cluster: 'alpha', signal: expect.any(AbortSignal) });
      expect(options?.method).toBeUndefined();
      expect(String(path)).not.toMatch(/\/(sidecars|destinationrules|pods|secrets)/);
    }
  }
);
