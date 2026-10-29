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
