import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { namespaceScope } from '../core/scope';
import { loadWorkloadGroupEntries } from './workloadGroupEntries';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({ ApiProxy: { request: vi.fn() } }));
vi.mock('../resources/registry', () => ({
  configurationDefinitions: [
    {
      kind: 'WorkloadEntry',
      group: 'networking.istio.io',
      plural: 'workloadentries',
      resourceClass: {
        isNamespaced: true,
        apiVersion: ['networking.istio.io/v1', 'networking.istio.io/v1beta1'],
      },
    },
  ],
}));
const group = 'networking.istio.io';
const entry = (index: number, labels: Record<string, string> = { app: 'vm' }) => ({
  metadata: {
    name: `entry-${index}`,
    namespace: 'bookinfo',
    uid: `entry-${index}`,
    labels: { ignored: 'metadata' },
  },
  spec: { labels, address: '10.0.0.8', network: '', serviceAccount: 'vm-account' },
});
function serve(list: (url: URL) => unknown, version = 'v1') {
  vi.mocked(ApiProxy.request).mockImplementation(async path => {
    const url = new URL(String(path), 'http://example.test');
    if (url.pathname === `/apis/${group}`)
      return { name: group, versions: [{ groupVersion: `${group}/${version}` }] };
    if (url.pathname === `/apis/${group}/${version}`)
      return {
        groupVersion: `${group}/${version}`,
        resources: [{ name: 'workloadentries', kind: 'WorkloadEntry', namespaced: true }],
      };
    expect(url.pathname).toBe(`/apis/${group}/${version}/namespaces/bookinfo/workloadentries`);
    expect(url.searchParams.has('labelSelector')).toBe(false);
    return list(url);
  });
}
const collection = (items: unknown[], metadata: Record<string, unknown> = {}, version = 'v1') => ({
  kind: 'WorkloadEntryList',
  apiVersion: `${group}/${version}`,
  metadata: { resourceVersion: '1', ...metadata },
  items,
});
beforeEach(() => {
  vi.mocked(ApiProxy.request).mockReset();
});
it('captures explicit scope and selector and matches spec labels instead of metadata labels', async () => {
  const scope = { cluster: 'alpha', namespace: 'bookinfo' };
  const selector = { app: 'vm' };
  serve(() =>
    collection([
      entry(1),
      { ...entry(2, { app: 'other' }), metadata: { ...entry(2).metadata, labels: { app: 'vm' } } },
    ])
  );
  const pending = loadWorkloadGroupEntries(scope, selector, new AbortController().signal);
  scope.cluster = 'beta';
  scope.namespace = 'other';
  selector.app = 'changed';
  const result = await pending;
  expect(result).toMatchObject({
    scope: { cluster: 'alpha', namespace: 'bookinfo' },
    selector: { app: 'vm' },
    complete: true,
    examined: 2,
  });
  expect(result.items).toHaveLength(1);
  expect(result.items[0]).toMatchObject({
    name: 'entry-1',
    uid: 'entry-1',
    network: '',
    serviceAccount: 'vm-account',
  });
  for (const [, options] of vi.mocked(ApiProxy.request).mock.calls)
    expect(options).toMatchObject({ cluster: 'alpha', signal: expect.any(AbortSignal) });
});
it('uses a discovered supported version and accepts missing kind/version only inside a validated list', async () => {
  serve(() => collection([entry(1)], {}, 'v1beta1'), 'v1beta1');
  const result = await loadWorkloadGroupEntries(
    namespaceScope('alpha', 'bookinfo'),
    { app: 'vm' },
    new AbortController().signal
  );
  expect(result.complete).toBe(true);
  expect(result.items[0].name).toBe('entry-1');
});
it('keeps label matches available while reporting malformed probe fields separately', async () => {
  serve(() =>
    collection([
      {
        ...entry(1),
        metadata: {
          ...entry(1).metadata,
          annotations: { 'proxy.istio.io/health-checks-enabled': 'true' },
        },
        status: { conditions: [{ type: 'Healthy', status: 'True' }] },
      },
      {
        ...entry(2),
        metadata: {
          ...entry(2).metadata,
          annotations: { 'proxy.istio.io/health-checks-enabled': 'true' },
        },
        status: { conditions: 'malformed' },
      },
      entry(3),
    ])
  );
  const result = await loadWorkloadGroupEntries(
    namespaceScope('alpha', 'bookinfo'),
    { app: 'vm' },
    new AbortController().signal
  );
  expect(result.complete).toBe(true);
  expect(result.items).toHaveLength(3);
  expect(result.items[0].health).toMatchObject({
    ok: true,
    evidence: { basis: 'condition', kialiAvailable: true },
  });
  expect(result.items[1].health).toMatchObject({
    ok: false,
    message: expect.stringContaining('100 conditions'),
  });
  expect(result.items[2].health).toMatchObject({
    ok: true,
    evidence: { basis: 'disabled-checks', kialiAvailable: true },
  });
});
it.each(['namespace', 'uid', 'labels', 'kind', 'version', 'address'])(
  'retains an explicit incomplete result for malformed %s',
  field => {
    const value = entry(1);
    if (field === 'namespace') value.metadata.namespace = 'other';
    if (field === 'uid') value.metadata.uid = ' ';
    if (field === 'labels') Object.assign(value.spec, { labels: { app: 1 } });
    if (field === 'kind') Object.assign(value, { kind: 'Service' });
    if (field === 'version') Object.assign(value, { apiVersion: 'wrong/v1' });
    if (field === 'address') Object.assign(value.spec, { address: 42 });
    serve(() => collection([value]));
    return expect(
      loadWorkloadGroupEntries(
        namespaceScope('alpha', 'bookinfo'),
        { app: 'vm' },
        new AbortController().signal
      )
    ).resolves.toMatchObject({
      complete: false,
      items: [],
      error: { message: expect.any(String) },
    });
  }
);
it('retains observed matches with an incomplete marker after a later-page denial', async () => {
  serve(url => {
    if (url.searchParams.has('continue')) throw { status: 403, message: 'Later page denied' };
    return collection([entry(1)], { continue: 'next' });
  });
  const result = await loadWorkloadGroupEntries(
    namespaceScope('alpha', 'bookinfo'),
    { app: 'vm' },
    new AbortController().signal
  );
  expect(result).toMatchObject({
    complete: false,
    examined: 1,
    error: { message: expect.stringContaining('Later page denied') },
  });
  expect(result.items).toHaveLength(1);
});
it('bounds reads to four pages without presenting a truncated list as complete', async () => {
  let page = 0;
  serve(() => {
    const index = page++;
    return collection(
      Array.from({ length: 250 }, (_, offset) => entry(index * 250 + offset)),
      { continue: `page-${page}` }
    );
  });
  const result = await loadWorkloadGroupEntries(
    namespaceScope('alpha', 'bookinfo'),
    { app: 'vm' },
    new AbortController().signal
  );
  expect(page).toBe(4);
  expect(result).toMatchObject({ complete: false, limited: true, examined: 1000 });
  expect(result.items).toHaveLength(1000);
});
it('marks excessive aggregate label text incomplete instead of retaining an unbounded projection', async () => {
  const labels = Object.fromEntries(
    Array.from({ length: 256 }, (_, index) => [`key-${index}`, 'x'.repeat(1024)])
  );
  serve(() => collection(Array.from({ length: 4 }, (_, index) => entry(index, labels))));
  const result = await loadWorkloadGroupEntries(
    namespaceScope('alpha', 'bookinfo'),
    { app: 'vm' },
    new AbortController().signal
  );
  expect(result.complete).toBe(false);
  expect(result.error?.message).toContain('1,000,000');
  expect(result.items).toEqual([]);
});

it('rejects empty selectors and cancelled scopes before issuing any request', async () => {
  const scope = namespaceScope('alpha', 'bookinfo');
  await expect(loadWorkloadGroupEntries(scope, {}, new AbortController().signal)).rejects.toThrow(
    'nonempty'
  );
  const controller = new AbortController();
  controller.abort();
  await expect(
    loadWorkloadGroupEntries(scope, { app: 'vm' }, controller.signal)
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(ApiProxy.request).not.toHaveBeenCalled();
});
it('times out even if API discovery ignores the linked abort signal', async () => {
  vi.useFakeTimers();
  try {
    vi.mocked(ApiProxy.request).mockImplementation(() => new Promise(() => {}));
    const pending = loadWorkloadGroupEntries(
      namespaceScope('alpha', 'bookinfo'),
      { app: 'vm' },
      new AbortController().signal
    );
    const rejected = expect(pending).rejects.toThrow('exceeded 15 seconds');
    await vi.advanceTimersByTimeAsync(15000);
    await rejected;
    expect(vi.mocked(ApiProxy.request).mock.calls[0][1]?.signal?.aborted).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});
