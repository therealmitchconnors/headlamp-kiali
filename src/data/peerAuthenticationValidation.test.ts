import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { referenceValidation } from '../core/referenceValidation';
import { clusterScope } from '../core/scope';
import { loadValidationSnapshot } from './validation';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  ApiProxy: { request: vi.fn() },
  K8s: { cluster: { KubeObject: class {} } },
}));
const group = 'security.istio.io';
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
  ['auto-default', undefined],
  ['namespace-strict', 'KIA0501'],
  ['mesh-strict', 'KIA0401'],
  ['root-fallback', 'KIA0401'],
  ['namespace-disable', 'KIA0505'],
  ['mesh-disable', 'KIA0506'],
  ['namespace-override', undefined],
  ['denied-rules', undefined],
  ['auto-denied-rules', undefined],
  ['denied-mesh', undefined],
  ['port-only', 'KIA0501'],
  ['private-rule', 'KIA0501'],
] as const)(
  'collects %s policy context without broadening the checker scope',
  async (mode, code) => {
    const namespace = ['mesh-strict', 'mesh-disable', 'root-fallback'].includes(mode)
      ? 'root'
      : 'bookinfo';
    const disabled = ['namespace-disable', 'mesh-disable', 'namespace-override'].includes(mode);
    const spec = { mtls: { mode: disabled ? 'DISABLE' : 'STRICT' } };
    vi.mocked(ApiProxy.request).mockImplementation(async path => {
      const url = new URL(String(path), 'http://example.test');
      if (url.pathname === '/apis/security.istio.io')
        return {
          name: group,
          versions: [{ groupVersion: `${group}/v1` }],
        };
      if (url.pathname === '/apis/security.istio.io/v1')
        return {
          groupVersion: `${group}/v1`,
          resources: [
            { name: 'peerauthentications', kind: 'PeerAuthentication', namespaced: true },
          ],
        };
      if (url.pathname.endsWith('/peerauthentications'))
        return collection('PeerAuthentication', `${group}/v1`, [
          {
            metadata: { name: 'selected', namespace, uid: 'selected-uid' },
            spec,
          },
        ]);
      if (url.pathname === '/apis/networking.istio.io')
        return {
          name: 'networking.istio.io',
          versions: [{ groupVersion: 'networking.istio.io/v1' }],
        };
      if (url.pathname === '/apis/networking.istio.io/v1')
        return {
          groupVersion: 'networking.istio.io/v1',
          resources: [{ name: 'destinationrules', kind: 'DestinationRule', namespaced: true }],
        };
      if (url.pathname === '/api/v1/namespaces')
        return collection(
          'Namespace',
          'v1',
          ['root', 'bookinfo'].map(name => ({
            metadata: { name, uid: name, labels: { 'istio.io/rev': 'blue' } },
          }))
        );
      if (url.pathname.endsWith('/destinationrules')) {
        if (mode === 'denied-rules' || mode === 'auto-denied-rules')
          throw { status: 403, message: 'DestinationRules denied' };
        const rule = (name: string, host: string, tls: string) => ({
          metadata: { name, namespace: 'root', uid: name },
          spec: {
            host,
            exportTo: mode === 'private-rule' ? ['.'] : ['*'],
            trafficPolicy: { tls: { mode: tls } },
          },
        });
        const items: unknown[] =
          disabled || mode === 'private-rule'
            ? [rule('mesh-client', '*.local', 'ISTIO_MUTUAL')]
            : mode === 'port-only'
            ? [
                {
                  metadata: { name: 'port-only', namespace: 'root', uid: 'port-only' },
                  spec: {
                    host: '*.bookinfo.svc.cluster.local',
                    exportTo: ['*'],
                    trafficPolicy: { portLevelSettings: [{ tls: { mode: 'ISTIO_MUTUAL' } }] },
                  },
                },
              ]
            : [];
        if (mode === 'namespace-override')
          items.push(rule('namespace-client', '*.bookinfo.svc.cluster.local', 'DISABLE'));
        return collection('DestinationRule', 'networking.istio.io/v1', items);
      }
      if (url.pathname === '/apis/apps/v1/deployments')
        return collection('Deployment', 'apps/v1', [
          {
            metadata: {
              name: 'istiod-blue',
              namespace: 'root',
              uid: 'cp',
              labels: { app: 'istiod', 'istio.io/rev': 'blue' },
            },
            spec: { template: { spec: { containers: [{ name: 'discovery' }] } } },
          },
        ]);
      if (url.pathname.endsWith('/mutatingwebhookconfigurations'))
        return collection('MutatingWebhookConfiguration', 'admissionregistration.k8s.io/v1', []);
      if (url.pathname.includes('/configmaps/')) {
        if (mode === 'denied-mesh') throw { status: 403, message: 'Mesh denied' };
        const name = url.pathname.split('/').pop();
        const root = mode === 'root-fallback' ? '' : 'rootNamespace: root\n';
        const auto = ['auto-default', 'auto-denied-rules'].includes(mode)
          ? ''
          : 'enableAutoMtls: false';
        return {
          kind: 'ConfigMap',
          apiVersion: 'v1',
          metadata: { name, namespace: 'root' },
          data: name?.includes('sidecar-injector') ? { values: '{}' } : { mesh: `${root}${auto}` },
        };
      }
      throw new Error(`Unexpected request ${path}`);
    });
    const signal = new AbortController().signal;
    const domain = namespace === 'root' ? null : 'svc.cluster.local';
    const snapshot = await loadValidationSnapshot(
      clusterScope('alpha'),
      'PeerAuthentication',
      group,
      spec,
      domain,
      signal,
      namespace
    );
    expect(snapshot.sources.map(source => source.key)).toEqual([
      'namespaces',
      'destinationRules',
      'peerAuthentications',
    ]);
    const result = referenceValidation(
      'PeerAuthentication',
      group,
      namespace,
      spec,
      snapshot.context,
      { name: 'selected', uid: 'selected-uid' }
    );
    expect(result.findings.map(finding => finding.code)).toEqual(code ? [code] : []);
    expect(result.skipped).toHaveLength(
      mode === 'denied-mesh' ? 2 : mode === 'denied-rules' ? 1 : 0
    );
    if (mode === 'auto-denied-rules')
      expect(snapshot.sources.find(source => source.key === 'destinationRules')?.error?.kind).toBe(
        'forbidden'
      );
    if (mode === 'root-fallback') {
      expect(snapshot.context.namespaceMesh?.get('root')).toMatchObject({
        status: 'ready',
        root: { namespace: 'root', basis: 'controller-namespace' },
      });
    }
    for (const [path, options] of vi.mocked(ApiProxy.request).mock.calls) {
      expect(options).toMatchObject({ cluster: 'alpha', signal: expect.any(AbortSignal) });
      expect(options?.method).toBeUndefined();
      expect(String(path)).not.toMatch(/\/(services|serviceentries|sidecars|pods|secrets)/);
    }
  }
);
it.each([
  { selector: { matchLabels: { app: 'reviews' } } },
  { mtls: { mode: 'PERMISSIVE' }, selector: { matchLabels: { app: 'reviews' } } },
  { mtls: { mode: 'STRICT' }, selector: { matchLabels: { app: 'reviews' } } },
  { mtls: { mode: 'DISABLE' }, selector: { matchLabels: { app: 'reviews' } } },
])('does not request unused source families %#', async spec => {
  const snapshot = await loadValidationSnapshot(
    clusterScope('alpha'),
    'PeerAuthentication',
    group,
    spec,
    null,
    new AbortController().signal,
    'bookinfo'
  );
  expect(snapshot.sources).toEqual([]);
  expect(ApiProxy.request).not.toHaveBeenCalled();
});
