import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { referenceValidation } from '../core/referenceValidation';
import { clusterScope } from '../core/scope';
import { loadValidationSnapshot } from './validation';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  ApiProxy: { request: vi.fn() },
  K8s: { cluster: { KubeObject: class {} } },
}));
const group = 'networking.istio.io';
const namespace = 'bookinfo';
const owner = { name: 'selected', uid: 'selected-uid' };
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
  ['enabled-mesh', 'KIA0205'],
  ['enabled-namespace', 'KIA0206'],
  ['disabled-mesh', 'KIA0208'],
  ['mesh-no-domain', 'KIA0208'],
  ['disabled-namespace', 'KIA0207'],
  ['permissive-override', undefined],
  ['disabled-override', undefined],
  ['auto-default', undefined],
  ['selected-stale', undefined],
  ['denied-peers', undefined],
  ['group-mismatch', undefined],
] as const)('collects group-correct policy evidence for %s', async (mode, code) => {
  const namespaceWide = [
    'enabled-namespace',
    'disabled-namespace',
    'permissive-override',
    'disabled-override',
  ].includes(mode);
  const disabled = [
    'disabled-mesh',
    'mesh-no-domain',
    'disabled-namespace',
    'permissive-override',
    'disabled-override',
    'selected-stale',
  ].includes(mode);
  const spec = {
    host: namespaceWide ? '*.bookinfo.svc.cluster.local' : '*.local',
    exportTo: ['*'],
    trafficPolicy: { tls: { mode: disabled ? 'DISABLE' : 'ISTIO_MUTUAL' } },
  };
  vi.mocked(ApiProxy.request).mockImplementation(async path => {
    const url = new URL(String(path), 'http://example.test');
    for (const [apiGroup, entries] of [
      [
        group,
        [
          { name: 'destinationrules', kind: 'DestinationRule', namespaced: true },
          { name: 'sidecars', kind: 'Sidecar', namespaced: true },
        ],
      ],
      [
        'security.istio.io',
        [{ name: 'peerauthentications', kind: 'PeerAuthentication', namespaced: true }],
      ],
    ] as const) {
      if (url.pathname === `/apis/${apiGroup}`)
        return { name: apiGroup, versions: [{ groupVersion: `${apiGroup}/v1` }] };
      if (url.pathname === `/apis/${apiGroup}/v1`)
        return { groupVersion: `${apiGroup}/v1`, resources: entries };
    }
    if (url.pathname === '/api/v1/namespaces')
      return collection(
        'Namespace',
        'v1',
        ['root', 'bookinfo'].map(name => ({
          metadata: { name, uid: name, labels: { 'istio.io/rev': 'blue' } },
        }))
      );
    if (url.pathname.endsWith('/destinationrules'))
      return collection('DestinationRule', `${group}/v1`, [
        {
          metadata: {
            name: owner.name,
            uid: mode === 'selected-stale' ? 'replacement' : owner.uid,
            namespace,
          },
          spec,
        },
      ]);
    if (url.pathname.endsWith('/sidecars')) return collection('Sidecar', `${group}/v1`, []);
    if (url.pathname.endsWith('/peerauthentications')) {
      if (mode === 'denied-peers') throw { status: 403, message: 'Peer policies denied' };
      const peer = (ns: string, peerMode: string) => ({
        apiVersion: mode === 'group-mismatch' ? `${group}/v1` : 'security.istio.io/v1',
        kind: 'PeerAuthentication',
        metadata: { name: `peer-${ns}`, namespace: ns, uid: `uid-${ns}` },
        spec: { mtls: { mode: peerMode } },
      });
      const peers = disabled
        ? [peer(mode === 'disabled-namespace' ? namespace : 'root', 'STRICT')]
        : mode === 'group-mismatch'
        ? [peer('root', 'STRICT')]
        : [];
      if (mode === 'permissive-override') peers.push(peer(namespace, 'PERMISSIVE'));
      if (mode === 'disabled-override') peers.push(peer(namespace, 'DISABLE'));
      return collection('PeerAuthentication', 'security.istio.io/v1', peers);
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
      const name = url.pathname.split('/').pop();
      return {
        kind: 'ConfigMap',
        apiVersion: 'v1',
        metadata: { name, namespace: 'root' },
        data: name?.includes('sidecar-injector')
          ? { values: '{}' }
          : {
              mesh: `rootNamespace: root\n${
                mode === 'auto-default' ? '' : 'enableAutoMtls: false'
              }`,
            },
      };
    }
    throw new Error(`Unexpected request ${path}`);
  });
  const signal = new AbortController().signal;
  const domain = mode === 'mesh-no-domain' ? null : 'svc.cluster.local';
  const snapshot = await loadValidationSnapshot(
    clusterScope('alpha'),
    'DestinationRule',
    group,
    spec,
    domain,
    signal,
    namespace
  );
  expect(snapshot.sources.map(source => source.key)).toEqual(
    mode === 'mesh-no-domain'
      ? ['namespaces', 'destinationRules', 'peerAuthentications']
      : ['namespaces', 'destinationRules', 'peerAuthentications', 'sidecars']
  );
  const result = referenceValidation(
    'DestinationRule',
    group,
    namespace,
    spec,
    snapshot.context,
    owner
  );
  expect(result.findings.map(finding => finding.code)).toEqual(code ? [code] : []);
  if (mode === 'selected-stale')
    expect(result.skipped.some(message => message.includes('changed'))).toBe(true);
  if (mode === 'denied-peers' || mode === 'group-mismatch')
    expect(snapshot.sources.find(source => source.key === 'peerAuthentications')?.error?.kind).toBe(
      mode === 'denied-peers' ? 'forbidden' : 'invalid-response'
    );
  for (const [path, options] of vi.mocked(ApiProxy.request).mock.calls) {
    expect(options).toMatchObject({ cluster: 'alpha', signal: expect.any(AbortSignal) });
    expect(options?.method).toBeUndefined();
    expect(String(path)).not.toMatch(/\/(services|pods|secrets)/);
  }
});
