import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { clusterScope } from '../core/scope';
import { configurationDefinitions } from '../resources/registry';
import { discoverConfiguration } from './configuration';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  ApiProxy: { request: vi.fn() },
  K8s: { cluster: { KubeObject: class {} } },
}));

const definition = configurationDefinitions[0];
const group = (versions = ['v1']) => ({
  name: definition.group,
  versions: versions.map(version => ({ groupVersion: `${definition.group}/${version}` })),
});
const resources = (version: string, entries: object[]) => ({
  groupVersion: `${definition.group}/${version}`,
  resources: entries,
});
beforeEach(() => {
  vi.mocked(ApiProxy.request).mockReset();
});

it('detects an absent API without pretending access denial means not installed', async () => {
  const signal = new AbortController().signal;
  vi.mocked(ApiProxy.request).mockRejectedValueOnce({ status: 404 });
  await expect(discoverConfiguration(clusterScope('alpha'), definition, signal)).resolves.toEqual({
    available: false,
    reason: 'absent',
  });
  for (const status of [401, 403, 500]) {
    vi.mocked(ApiProxy.request).mockRejectedValueOnce({ status });
    await expect(discoverConfiguration(clusterScope('alpha'), definition, signal)).rejects.toEqual({
      status,
    });
  }
});

it('selects a supported served resource version without mutating shared metadata', async () => {
  const before = definition.resourceClass.apiVersion;
  vi.mocked(ApiProxy.request)
    .mockResolvedValueOnce(group(['v1beta1']))
    .mockResolvedValueOnce(
      resources('v1beta1', [{ name: 'virtualservices', kind: 'VirtualService', namespaced: true }])
    );
  await expect(
    discoverConfiguration(clusterScope('beta'), definition, new AbortController().signal)
  ).resolves.toEqual({ available: true, apiVersion: 'networking.istio.io/v1beta1' });
  expect(definition.resourceClass.apiVersion).toBe(before);
  expect(vi.mocked(ApiProxy.request).mock.calls.every(call => call[1]?.cluster === 'beta')).toBe(
    true
  );
});

it('distinguishes unsupported API versions from an absent resource', async () => {
  vi.mocked(ApiProxy.request).mockResolvedValueOnce(group(['v9']));
  await expect(
    discoverConfiguration(clusterScope('alpha'), definition, new AbortController().signal)
  ).resolves.toEqual({ available: false, reason: 'unsupported-version' });
  vi.mocked(ApiProxy.request)
    .mockResolvedValueOnce(group())
    .mockResolvedValueOnce(resources('v1', []));
  await expect(
    discoverConfiguration(clusterScope('alpha'), definition, new AbortController().signal)
  ).resolves.toEqual({ available: false, reason: 'absent' });
});

it('rejects malformed or wrong-scope discovery instead of returning success', async () => {
  vi.mocked(ApiProxy.request)
    .mockResolvedValueOnce(group())
    .mockResolvedValueOnce(
      resources('v1', [{ name: 'virtualservices', kind: 'VirtualService', namespaced: false }])
    );
  await expect(
    discoverConfiguration(clusterScope('alpha'), definition, new AbortController().signal)
  ).rejects.toThrow('Unexpected scope');
  vi.mocked(ApiProxy.request).mockResolvedValueOnce({ name: 'wrong', versions: [] });
  await expect(
    discoverConfiguration(clusterScope('alpha'), definition, new AbortController().signal)
  ).rejects.toThrow('Invalid API group');
});

it('accepts a cluster-scoped GatewayClass but rejects namespaced scope for the same kind', async () => {
  const gatewayClass = configurationDefinitions.find(entry => entry.kind === 'GatewayClass')!;
  for (const namespaced of [false, true]) {
    vi.mocked(ApiProxy.request)
      .mockResolvedValueOnce({
        name: gatewayClass.group,
        versions: [{ groupVersion: `${gatewayClass.group}/v1` }],
      })
      .mockResolvedValueOnce({
        groupVersion: `${gatewayClass.group}/v1`,
        resources: [{ name: gatewayClass.plural, kind: gatewayClass.kind, namespaced }],
      });
    const result = discoverConfiguration(
      clusterScope('alpha'),
      gatewayClass,
      new AbortController().signal
    );
    if (namespaced) await expect(result).rejects.toThrow('Unexpected scope');
    else
      await expect(result).resolves.toEqual({
        available: true,
        apiVersion: 'gateway.networking.k8s.io/v1',
      });
  }
});
