import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { referenceValidation } from '../core/referenceValidation';
import { clusterScope } from '../core/scope';
import { loadValidationSnapshot } from './validation';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  ApiProxy: { request: vi.fn() },
  K8s: { cluster: { KubeObject: class {} } },
}));
const selected = { workloadSelector: { labels: { app: 'reviews' } } };
const collection = (kind: string, apiVersion: string, items: unknown[]) => ({
  kind: `${kind}List`,
  apiVersion,
  metadata: { resourceVersion: '1' },
  items,
});
const controller = {
  metadata: {
    name: 'istiod-blue',
    namespace: 'control-plane',
    uid: 'cp',
    labels: { app: 'istiod', 'istio.io/rev': 'blue' },
  },
  spec: { template: { spec: { containers: [{ name: 'discovery' }] } } },
};
beforeEach(() => {
  vi.mocked(ApiProxy.request).mockReset();
});

it.each([
  'root',
  'non-root',
  'missing-root',
  'root-fallback',
  'denied',
  'denied-namespaces',
  'denied-tags',
  'ambiguous',
  'excluded',
  'malformed-selectors',
])('retains %s namespace mesh evidence independently of import sources', async mode => {
  const namespace =
    mode === 'root-fallback'
      ? 'control-plane'
      : mode === 'missing-root'
      ? 'istio-system'
      : mode === 'root'
      ? 'mesh-root'
      : 'bookinfo';
  vi.mocked(ApiProxy.request).mockImplementation(async path => {
    const url = new URL(String(path), 'http://example.test');
    if (url.pathname === '/api/v1/namespaces') {
      if (mode === 'denied-namespaces') throw { status: 403, message: 'Namespace list denied' };
      return collection(
        'Namespace',
        'v1',
        ['mesh-root', 'bookinfo', 'istio-system', 'control-plane'].map(name => ({
          metadata: { name, uid: name, labels: { 'istio.io/rev': 'blue' } },
        }))
      );
    }
    if (url.pathname === '/apis/apps/v1/deployments')
      return collection(
        'Deployment',
        'apps/v1',
        mode === 'ambiguous'
          ? [
              controller,
              { ...controller, metadata: { ...controller.metadata, name: 'other', uid: 'other' } },
            ]
          : [controller]
      );
    if (url.pathname.endsWith('/mutatingwebhookconfigurations')) {
      if (mode === 'denied-tags') throw { status: 403, message: 'Revision tags denied' };
      return collection('MutatingWebhookConfiguration', 'admissionregistration.k8s.io/v1', []);
    }
    if (url.pathname.includes('/configmaps/')) {
      if (mode === 'denied') throw { status: 403, message: 'Mesh configuration denied' };
      const name = url.pathname.split('/').pop();
      return {
        kind: 'ConfigMap',
        apiVersion: 'v1',
        metadata: { name, namespace: 'control-plane' },
        data: name?.includes('sidecar-injector')
          ? { values: '{}' }
          : {
              mesh: ['missing-root', 'root-fallback'].includes(mode)
                ? '{}'
                : `rootNamespace: mesh-root\n${
                    mode === 'excluded'
                      ? 'discoverySelectors: [{matchLabels: {team: included}}]'
                      : mode === 'malformed-selectors'
                      ? 'discoverySelectors: [{matchLabels: {team: 1}}]'
                      : ''
                  }`,
            },
      };
    }
    throw new Error(`Unexpected request ${path}`);
  });
  const signal = new AbortController().signal;
  const snapshot = await loadValidationSnapshot(
    clusterScope('alpha'),
    'Sidecar',
    'networking.istio.io',
    selected,
    null,
    signal,
    namespace
  );
  expect(snapshot.sources).toEqual([]);
  expect(snapshot.context.namespaceMesh?.size).toBe(1);
  expect(snapshot.context.sidecars.complete).toBe(false);
  const result = referenceValidation(
    'Sidecar',
    'networking.istio.io',
    namespace,
    selected,
    snapshot.context
  );
  expect(result.findings.map(finding => finding.code)).toEqual(
    ['root', 'root-fallback'].includes(mode) ? ['KIA1006'] : []
  );
  expect(result.skipped).toHaveLength(
    ['root', 'non-root', 'missing-root', 'root-fallback'].includes(mode) ? 0 : 1
  );
  for (const [path, options] of vi.mocked(ApiProxy.request).mock.calls) {
    expect(options).toMatchObject({ cluster: 'alpha', signal: expect.any(AbortSignal) });
    expect(options?.method).toBeUndefined();
    expect(String(path)).not.toMatch(/sidecars|destinationrules|pods|secrets/);
  }
});

it.each([
  {},
  { workloadSelector: {} },
  { workloadSelector: { labels: {} } },
  { workloadSelector: null },
])('does not load mesh for an empty selector %#', async spec => {
  const result = await loadValidationSnapshot(
    clusterScope('alpha'),
    'Sidecar',
    'networking.istio.io',
    spec,
    null,
    new AbortController().signal,
    'mesh-root'
  );
  expect(result.context.namespaceMesh).toBeUndefined();
  expect(ApiProxy.request).not.toHaveBeenCalled();
});

it('rejects pre-aborted checks before any discovery, including empty selectors', async () => {
  const controller = new AbortController();
  controller.abort();
  for (const spec of [selected, {}])
    await expect(
      loadValidationSnapshot(
        clusterScope('alpha'),
        'Sidecar',
        'networking.istio.io',
        spec,
        null,
        controller.signal,
        'mesh-root'
      )
    ).rejects.toThrow();
  expect(ApiProxy.request).not.toHaveBeenCalled();
});

it('does not return namespace mesh context from cancelled discovery', async () => {
  const abort = new AbortController();
  vi.mocked(ApiProxy.request).mockImplementation(async () => {
    abort.abort();
    throw new DOMException('Aborted', 'AbortError');
  });
  await expect(
    loadValidationSnapshot(
      clusterScope('alpha'),
      'Sidecar',
      'networking.istio.io',
      selected,
      null,
      abort.signal,
      'mesh-root'
    )
  ).rejects.toThrow();
});
