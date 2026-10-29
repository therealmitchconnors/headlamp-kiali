import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { clusterScope } from '../core/scope';
import { readCollection } from './collections';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({ ApiProxy: { request: vi.fn() } }));
const request = { path: '/api/v1/namespaces', apiVersion: 'v1', kind: 'Namespace' };
beforeEach(() => {
  vi.mocked(ApiProxy.request).mockReset();
});
it('does not declare completeness when the server omits continuation for remaining items', async () => {
  vi.mocked(ApiProxy.request).mockResolvedValue({
    kind: 'NamespaceList',
    apiVersion: 'v1',
    metadata: { resourceVersion: '1', remainingItemCount: 1 },
    items: [],
  });
  const result = await readCollection(
    clusterScope('alpha'),
    request,
    value => value,
    new AbortController().signal
  );
  expect(result.complete).toBe(false);
  expect(result.error?.kind).toBe('invalid-response');
});
it('validates envelope type, item identity, page sizes and decoder failures', async () => {
  vi.mocked(ApiProxy.request).mockResolvedValue({
    kind: 'NamespaceList',
    apiVersion: 'v1',
    metadata: { resourceVersion: '1' },
    items: [{ metadata: { name: 'bookinfo', uid: 'ns' } }],
  });
  const result = await readCollection(
    clusterScope('alpha'),
    request,
    value => {
      expect(value.kind).toBe('Namespace');
      expect(value.apiVersion).toBe('v1');
      throw new Error('Bad decoded value');
    },
    new AbortController().signal
  );
  expect(result.error?.kind).toBe('invalid-response');
  const invalid = await readCollection(
    clusterScope('alpha'),
    { ...request, pageSize: 251 },
    value => value,
    new AbortController().signal
  );
  expect(invalid.complete).toBe(false);
  expect(ApiProxy.request).toHaveBeenCalledTimes(1);
});
