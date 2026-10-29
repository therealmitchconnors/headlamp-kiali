import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { referenceValidation } from '../core/referenceValidation';
import { clusterScope } from '../core/scope';
import { loadValidationSnapshot } from './validation';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  ApiProxy: { request: vi.fn() },
  K8s: { cluster: { KubeObject: class {} } },
}));
const group = 'networking.istio.io';
const spec = { egress: [{ hosts: ['*/reviews.other'] }] };
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
  'private',
  'empty-annotation',
  'public-annotation',
  'denied-services',
  'denied-entries',
  'unknown-default',
  'invalid-annotation',
  'service-entry',
])('collects only scoped registry evidence for %s', async mode => {
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
        ['bookinfo', 'other', 'control-plane'].map(name => ({
          metadata: { name, uid: name, labels: { 'istio.io/rev': 'blue' } },
        }))
      );
    if (url.pathname === '/api/v1/services') {
      if (mode === 'denied-services') throw { status: 403, message: 'Services denied' };
      return collection('Service', 'v1', [
        {
          metadata: {
            name: 'reviews',
            namespace: 'other',
            uid: 'svc',
            annotations: {
              unrelated: 'not copied',
              ...(['empty-annotation', 'public-annotation', 'invalid-annotation'].includes(mode)
                ? {
                    'networking.istio.io/exportTo':
                      mode === 'empty-annotation' ? '' : mode === 'public-annotation' ? '*' : 123,
                  }
                : {}),
            },
          },
          spec: {},
        },
      ]);
    }
    if (url.pathname.endsWith('/serviceentries')) {
      if (mode === 'denied-entries') throw { status: 403, message: 'Entries denied' };
      return collection(
        'ServiceEntry',
        `${group}/v1`,
        mode === 'service-entry'
          ? [
              {
                metadata: { name: 'external', namespace: 'other', uid: 'se' },
                spec: { hosts: ['reviews.other'], exportTo: ['*'] },
              },
            ]
          : []
      );
    }
    if (url.pathname === '/apis/apps/v1/deployments')
      return collection('Deployment', 'apps/v1', [
        {
          metadata: {
            name: 'istiod-blue',
            namespace: 'control-plane',
            uid: 'cp',
            labels: { app: 'istiod', 'istio.io/rev': 'blue' },
          },
          spec: { template: { spec: { containers: [{ name: 'discovery' }] } } },
        },
      ]);
    if (url.pathname.endsWith('/mutatingwebhookconfigurations'))
      return collection('MutatingWebhookConfiguration', 'admissionregistration.k8s.io/v1', []);
    if (url.pathname.includes('/configmaps/')) {
      if (mode === 'unknown-default') throw { status: 403, message: 'Mesh denied' };
      const name = url.pathname.split('/').pop();
      return {
        kind: 'ConfigMap',
        apiVersion: 'v1',
        metadata: { name, namespace: 'control-plane' },
        data: name?.includes('sidecar-injector')
          ? { values: '{}' }
          : { mesh: 'rootNamespace: control-plane\ndefaultServiceExportTo: ["."]' },
      };
    }
    throw new Error(`Unexpected request ${path}`);
  });
  const signal = new AbortController().signal;
  const snapshot = await loadValidationSnapshot(
    clusterScope('alpha'),
    'Sidecar',
    group,
    spec,
    'svc.cluster.local',
    signal,
    'bookinfo'
  );
  expect(snapshot.sources.map(source => source.key)).toEqual([
    'namespaces',
    'services',
    'serviceEntries',
  ]);
  const result = referenceValidation('Sidecar', group, 'bookinfo', spec, snapshot.context);
  expect(result.findings.map(finding => finding.code)).toEqual(
    mode === 'private' ? ['KIA1004'] : []
  );
  expect(result.skipped).toHaveLength(
    ['denied-services', 'denied-entries', 'unknown-default', 'invalid-annotation'].includes(mode)
      ? 1
      : 0
  );
  if (mode === 'empty-annotation')
    expect(snapshot.context.services?.items[0]).toMatchObject({ exportToAnnotation: '' });
  for (const item of snapshot.context.services?.items ?? [])
    expect(item).not.toHaveProperty('annotations');
  if (mode === 'denied-services' || mode === 'invalid-annotation')
    expect(snapshot.sources.find(source => source.key === 'services')?.error?.kind).toBe(
      mode === 'denied-services' ? 'forbidden' : 'invalid-response'
    );
  for (const [path, options] of vi.mocked(ApiProxy.request).mock.calls) {
    expect(options).toMatchObject({ cluster: 'alpha', signal: expect.any(AbortSignal) });
    expect(options?.method).toBeUndefined();
    expect(String(path)).not.toMatch(/\/(sidecars|destinationrules|pods|secrets)/);
  }
});
it.each([null, 'svc.cluster.local'])(
  'avoids registry reads for all-namespace wildcards with domain %s',
  async domain => {
    const result = await loadValidationSnapshot(
      clusterScope('alpha'),
      'Sidecar',
      group,
      { egress: [{ hosts: ['*/*', './*', 'other/*'] }] },
      domain,
      new AbortController().signal,
      'bookinfo'
    );
    expect(result.sources).toEqual([]);
    expect(ApiProxy.request).not.toHaveBeenCalled();
  }
);
it('retains the DNS-context deferral without guessing a suffix or issuing requests', async () => {
  const snapshot = await loadValidationSnapshot(
    clusterScope('alpha'),
    'Sidecar',
    group,
    spec,
    null,
    new AbortController().signal,
    'bookinfo'
  );
  const result = referenceValidation('Sidecar', group, 'bookinfo', spec, snapshot.context);
  expect(result.findings).toEqual([]);
  expect(result.skipped[0]).toMatch(/DNS identity/);
  expect(ApiProxy.request).not.toHaveBeenCalled();
});
