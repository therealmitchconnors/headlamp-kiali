import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { namespaceScope } from '../core/scope';
import { CORRELATION_SOURCES, loadCorrelationSnapshot } from './correlation';
import { readVirtualWorkloadSource } from './virtualWorkloads';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  ApiProxy: { request: vi.fn() },
  K8s: { cluster: { KubeObject: class {} } },
}));
const scope = namespaceScope('alpha', 'bookinfo');
const group = 'networking.istio.io';
const object = (name: string, spec: unknown, extra = {}) => ({
  metadata: {
    name,
    namespace: 'bookinfo',
    uid: name,
    resourceVersion: `${name}-version`,
    labels: { app: 'object-metadata' },
  },
  spec,
  ...extra,
});
const collection = (kind: string, apiVersion: string, items: unknown[], token = '') => ({
  kind: `${kind}List`,
  apiVersion,
  metadata: { resourceVersion: '1', continue: token },
  items,
});
beforeEach(() => {
  vi.mocked(ApiProxy.request).mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

it.each([
  'ready',
  'v1beta1',
  'no-groups',
  'empty-selector',
  'absent',
  'denied-groups',
  'unsupported',
  'entry-absent',
  'entry-denied',
  'entry-partial',
  'bad-group',
  'stale-entry-list',
  'wrong-namespace',
  'label-budget',
])('reads VM grouping with %s evidence', async mode => {
  const version = mode === 'v1beta1' ? 'v1beta1' : mode === 'unsupported' ? 'v9' : 'v1';
  const apiVersion = `${group}/${version}`;
  vi.mocked(ApiProxy.request).mockImplementation(async path => {
    const url = new URL(String(path), 'http://example.test');
    if (url.pathname === `/apis/${group}`) {
      if (mode === 'absent') throw { status: 404, message: 'Not served' };
      return { name: group, versions: [{ groupVersion: apiVersion }] };
    }
    if (url.pathname === `/apis/${apiVersion}`)
      return {
        groupVersion: apiVersion,
        resources: [
          { kind: 'WorkloadGroup', name: 'workloadgroups', namespaced: true },
          ...(mode === 'entry-absent'
            ? []
            : [{ kind: 'WorkloadEntry', name: 'workloadentries', namespaced: true }]),
        ],
      };
    if (url.pathname.endsWith('/workloadgroups')) {
      if (mode === 'denied-groups') throw { status: 403, message: 'WorkloadGroups denied' };
      return collection(
        'WorkloadGroup',
        apiVersion,
        mode === 'no-groups'
          ? []
          : [
              object(
                'vm-group',
                mode === 'bad-group'
                  ? { metadata: { labels: { app: 1 } } }
                  : {
                      metadata: { labels: mode === 'empty-selector' ? {} : { app: 'vm' } },
                      template: { labels: { app: 'template-is-not-selector' } },
                    }
              ),
            ]
      );
    }
    if (url.pathname.endsWith('/workloadentries')) {
      if (mode === 'entry-denied' || (mode === 'entry-partial' && url.searchParams.has('continue')))
        throw { status: 403, message: 'WorkloadEntries denied' };
      if (mode === 'stale-entry-list' && url.searchParams.has('continue'))
        return {
          ...collection('WorkloadEntry', apiVersion, []),
          metadata: { resourceVersion: 'changed' },
        };
      const item = object('first-entry', { labels: { app: 'vm', version: 'v1' } });
      if (mode === 'wrong-namespace') item.metadata.namespace = 'other';
      if (mode === 'label-budget')
        return collection(
          'WorkloadEntry',
          apiVersion,
          Array.from({ length: 11 }, (_, i) =>
            object(`entry-${i}`, {
              labels: Object.fromEntries(
                Array.from({ length: 100 }, (_, k) => [
                  `key${String(k).padStart(3, '0')}`,
                  'x'.repeat(994),
                ])
              ),
            })
          ),
          'unused-page'
        );
      return collection(
        'WorkloadEntry',
        apiVersion,
        [item],
        mode === 'entry-partial' || mode === 'stale-entry-list' ? 'next' : ''
      );
    }
    throw new Error(`Unexpected VM request ${path}`);
  });
  const result = await readVirtualWorkloadSource(scope, new AbortController().signal);
  const complete = ['ready', 'v1beta1', 'no-groups', 'empty-selector', 'absent'].includes(mode);
  expect(result.complete).toBe(complete);
  if (mode === 'ready' || mode === 'v1beta1') {
    expect(result.source.apiVersion).toBe(apiVersion);
    expect(result.resources[0]).toMatchObject({
      identity: { kind: 'WorkloadGroup', uid: 'vm-group', name: 'vm-group', namespace: 'bookinfo' },
      resourceVersion: 'vm-group-version',
      workloadLabels: { app: 'vm', version: 'v1' },
      virtualMachine: { matchingEntries: 1, entry: { name: 'first-entry', uid: 'first-entry' } },
    });
  } else if (mode === 'empty-selector') expect(result.resources[0].workloadLabels).toEqual({});
  else expect(result.resources).toEqual([]);
  if (mode === 'absent') expect(result.notServed).toBe(true);
  if (!complete) expect(result.error?.message).toBeTruthy();
  if (mode === 'label-budget') {
    expect(result.error).toMatchObject({ kind: 'invalid-response' });
    expect(result.error?.message).toContain('1,000,000');
    expect(
      vi.mocked(ApiProxy.request).mock.calls.some(([path]) => String(path).includes('continue='))
    ).toBe(false);
  }
  if (mode === 'empty-selector' || mode === 'no-groups' || mode === 'absent')
    expect(
      vi
        .mocked(ApiProxy.request)
        .mock.calls.some(([path]) => String(path).includes('/workloadentries'))
    ).toBe(false);
  for (const [path, options] of vi.mocked(ApiProxy.request).mock.calls) {
    expect(options).toMatchObject({ cluster: 'alpha' });
    expect(options?.method).toBeUndefined();
    expect(path).not.toContain('/secrets/');
    if (String(path).includes('workloadgroups?') || String(path).includes('workloadentries?'))
      expect(path).toContain('/namespaces/bookinfo/');
  }
});

it('bounds VM reads within the shared snapshot deadline and captures its scope', async () => {
  vi.useFakeTimers();
  vi.mocked(ApiProxy.request).mockImplementation(async path => {
    const standard = CORRELATION_SOURCES.find(source =>
      String(path).includes(`/${source.plural}?`)
    );
    if (standard) return collection(standard.kind, standard.apiVersion, []);
    return new Promise(() => {});
  });
  const mutable = { ...namespaceScope('alpha', 'bookinfo') };
  const pending = loadCorrelationSnapshot(mutable, new AbortController().signal);
  const rejected = expect(pending).rejects.toThrow('Namespace correlation exceeded 15 seconds');
  Object.assign(mutable, { cluster: 'other', namespace: 'elsewhere' });
  await vi.advanceTimersByTimeAsync(15000);
  await rejected;
  expect(vi.mocked(ApiProxy.request).mock.calls).toHaveLength(10);
  for (const [path, options] of vi.mocked(ApiProxy.request).mock.calls) {
    expect(options).toMatchObject({ cluster: 'alpha' });
    expect(path).not.toContain('elsewhere');
    expect(options?.signal?.aborted).toBe(true);
  }
});
