import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { configurationDefinitions } from '../resources/registry';
import { commitMutationBatch, reviewMutationBatch } from './mutationBatch';
import { prepareMutation } from './mutations';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  ApiProxy: { request: vi.fn() },
  K8s: { cluster: { KubeObject: class {} } },
}));
const mutation = (kind: string, name = 'reviews') =>
  prepareMutation(
    {
      cluster: 'alpha',
      namespace: 'bookinfo',
      name,
      apiVersion: 'networking.istio.io/v1',
      definition: configurationDefinitions.find(definition => definition.kind === kind)!,
    },
    'create',
    JSON.stringify({ host: 'reviews', nested: { values: [{ value: 1 }] } })
  );
const operations = () => [mutation('DestinationRule'), mutation('VirtualService')];
const originals = {
  DestinationRule: {
    apiVersion: 'networking.istio.io/v1',
    kind: 'DestinationRule',
    metadata: {
      name: 'reviews',
      namespace: 'bookinfo',
      uid: 'dr-uid',
      resourceVersion: '4',
      creationTimestamp: '2026-01-01T00:00:00Z',
      labels: { preserved: 'yes' },
    },
    spec: { host: 'reviews.bookinfo.svc.cluster.local', future: true },
  },
  VirtualService: {
    apiVersion: 'networking.istio.io/v1',
    kind: 'VirtualService',
    metadata: {
      name: 'reviews',
      namespace: 'bookinfo',
      uid: 'vs-uid',
      resourceVersion: '7',
      creationTimestamp: '2026-01-01T00:00:00Z',
      annotations: { preserved: 'yes' },
    },
    spec: { hosts: ['reviews.bookinfo.svc.cluster.local'], http: [{ route: [] }] },
  },
};
const updateOperations = () =>
  (['DestinationRule', 'VirtualService'] as const).map(kind => {
    const definition = configurationDefinitions.find(item => item.kind === kind)!;
    return prepareMutation(
      {
        cluster: 'alpha',
        namespace: 'bookinfo',
        name: 'reviews',
        apiVersion: 'networking.istio.io/v1',
        definition,
      },
      'update',
      JSON.stringify({ ...originals[kind].spec, proposed: true }),
      originals[kind]
    );
  });
beforeEach(() => {
  vi.mocked(ApiProxy.request).mockReset();
  vi.mocked(ApiProxy.request).mockImplementation(async path =>
    String(path).includes('selfsubjectaccessreviews') ? { status: { allowed: true } } : {}
  );
});
it('requires successful review, freezes nested proposals and consumes one commit attempt', async () => {
  const signal = new AbortController().signal;
  const guard = vi.fn(async () => {});
  const mutations = operations();
  await expect(commitMutationBatch({ mutations }, signal, guard)).rejects.toThrow('Review');
  expect(ApiProxy.request).not.toHaveBeenCalled();
  const reviewed = await reviewMutationBatch(mutations, signal, guard);
  expect(Object.isFrozen(reviewed.mutations)).toBe(true);
  const spec = mutations[0].spec as { nested: { values: { value: number }[] } };
  expect(Object.isFrozen(spec.nested.values[0])).toBe(true);
  mutations.push(mutation('VirtualService', 'not-reviewed'));
  const results = await commitMutationBatch(reviewed, signal, guard);
  expect(results.map(result => result.status)).toEqual(['succeeded', 'succeeded']);
  const writes = vi
    .mocked(ApiProxy.request)
    .mock.calls.filter(([path]) => !String(path).includes('selfsubjectaccessreviews'));
  expect(writes.map(([path]) => path)).toEqual([
    '/apis/networking.istio.io/v1/namespaces/bookinfo/destinationrules?dryRun=All',
    '/apis/networking.istio.io/v1/namespaces/bookinfo/virtualservices?dryRun=All',
    '/apis/networking.istio.io/v1/namespaces/bookinfo/destinationrules',
    '/apis/networking.istio.io/v1/namespaces/bookinfo/virtualservices',
  ]);
  expect(guard).toHaveBeenCalledTimes(4);
  await expect(commitMutationBatch(reviewed, signal, guard)).rejects.toThrow('cannot be repeated');
  expect(ApiProxy.request).toHaveBeenCalledTimes(8);
});
it('stops after an unknown write outcome and never retries or rolls back earlier successes', async () => {
  const signal = new AbortController().signal;
  const guard = async () => {};
  const reviewed = await reviewMutationBatch(
    [...operations(), mutation('VirtualService', 'later')],
    signal,
    guard
  );
  vi.mocked(ApiProxy.request).mockImplementation(async path => {
    if (String(path).includes('selfsubjectaccessreviews')) return { status: { allowed: true } };
    if (String(path).endsWith('/virtualservices')) throw new Error('Connection lost');
    return {};
  });
  const outcomes = await commitMutationBatch(reviewed, signal, guard);
  expect(outcomes.map(result => result.status)).toEqual([
    'succeeded',
    'failed-or-unknown',
    'not-attempted',
  ]);
  expect(
    vi.mocked(ApiProxy.request).mock.calls.some(([, options]) => options?.method === 'DELETE')
  ).toBe(false);
  expect(
    vi
      .mocked(ApiProxy.request)
      .mock.calls.filter(([path]) => String(path).endsWith('/virtualservices'))
  ).toHaveLength(1);
});
it('distinguishes a pre-write guard or permission failure from a dispatched uncertain write', async () => {
  const signal = new AbortController().signal;
  const reviewed = await reviewMutationBatch(operations(), signal, async () => {});
  vi.mocked(ApiProxy.request).mockClear();
  const result = await commitMutationBatch(reviewed, signal, async () => {
    throw new Error('Service changed');
  });
  expect(result.map(item => item.status)).toEqual(['blocked', 'not-attempted']);
  expect(ApiProxy.request).not.toHaveBeenCalled();
  const next = await reviewMutationBatch(operations(), signal, async () => {});
  vi.mocked(ApiProxy.request).mockResolvedValue({
    status: { allowed: false, reason: 'Permission changed' },
  });
  expect(
    (await commitMutationBatch(next, signal, async () => {})).map(item => item.status)
  ).toEqual(['blocked', 'not-attempted']);
});
it('dry-runs each captured existing target before confirmation and preserves its metadata on update', async () => {
  vi.mocked(ApiProxy.request).mockImplementation(async path => {
    const url = String(path);
    if (url.includes('selfsubjectaccessreviews')) return { status: { allowed: true } };
    if (url.includes('/destinationrules/')) return originals.DestinationRule;
    if (url.includes('/virtualservices/')) return originals.VirtualService;
    return {};
  });
  const signal = new AbortController().signal;
  const guard = vi.fn(async () => {});
  const mutations = updateOperations();
  const reviewed = await reviewMutationBatch(mutations, signal, guard);
  const reviewedWrites = vi
    .mocked(ApiProxy.request)
    .mock.calls.filter(([, options]) => options?.method === 'PUT');
  expect(reviewedWrites.map(([path]) => path)).toEqual([
    '/apis/networking.istio.io/v1/namespaces/bookinfo/destinationrules/reviews?dryRun=All',
    '/apis/networking.istio.io/v1/namespaces/bookinfo/virtualservices/reviews?dryRun=All',
  ]);
  expect(reviewedWrites.map(([, options]) => JSON.parse(String(options?.body)).metadata)).toEqual([
    originals.DestinationRule.metadata,
    originals.VirtualService.metadata,
  ]);
  expect(guard).toHaveBeenCalledTimes(2);
  const beforeConfirmation = vi.mocked(ApiProxy.request).mock.calls.length;
  expect(beforeConfirmation).toBe(6);
  const outcomes = await commitMutationBatch(reviewed, signal, guard);
  expect(outcomes.map(result => result.status)).toEqual(['succeeded', 'succeeded']);
  const writes = vi
    .mocked(ApiProxy.request)
    .mock.calls.filter(([, options]) => options?.method === 'PUT');
  expect(writes).toHaveLength(4);
  expect(writes.slice(2).map(([path]) => path)).toEqual([
    '/apis/networking.istio.io/v1/namespaces/bookinfo/destinationrules/reviews',
    '/apis/networking.istio.io/v1/namespaces/bookinfo/virtualservices/reviews',
  ]);
  expect(JSON.parse(String(writes[2][1]?.body))).toEqual({
    ...originals.DestinationRule,
    spec: { ...originals.DestinationRule.spec, proposed: true },
  });
  expect(JSON.parse(String(writes[3][1]?.body))).toEqual({
    ...originals.VirtualService,
    spec: { ...originals.VirtualService.spec, proposed: true },
  });
});
it('rejects duplicate/mixed-cluster batches and preserves cancellation before sending writes', async () => {
  const signal = new AbortController().signal;
  const op = mutation('DestinationRule');
  await expect(reviewMutationBatch([op, op], signal, async () => {})).rejects.toThrow(
    'same resource'
  );
  const other = prepareMutation({ ...op.target, cluster: 'beta' }, 'create', '{}');
  await expect(reviewMutationBatch([op, other], signal, async () => {})).rejects.toThrow(
    'one explicit cluster'
  );
  const reviewed = await reviewMutationBatch(operations(), signal, async () => {});
  vi.mocked(ApiProxy.request).mockClear();
  const controller = new AbortController();
  controller.abort();
  expect(
    (await commitMutationBatch(reviewed, controller.signal, async () => {})).map(
      item => item.status
    )
  ).toEqual(['blocked', 'not-attempted']);
  expect(ApiProxy.request).not.toHaveBeenCalled();
});
